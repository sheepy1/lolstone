// 预热：对局里第一次用到某个效果时卡一帧，原因是现编译着色器、现上传贴图、现画卡面。这里在对局开始前把它们做掉。
// - 着色器：对局场景建好时排一次"彩排"（warmCombatFx）：每种特效物件各建一份，用各模块自己的函数建（材质参数和真用到时
//   完全一样，编译出的程序才对得上），放进台面下面一个缩到千分之一的组里；粒子每个预设各发一次，也发在台面下、缩到千分之一。
//   它们在开局第一帧照常画一次（这一帧本来就在加载页后面，编译全落在这一帧），第二帧藏起来（不释放，见 rehearse）。直接画一次而不是只用
//   compileAsync，是因为泛光那一遍用深度材质重画选中的物件，粒子这种实例化网格的深度变体只有真画的时候才编译。
//   全屏四边形、枢纽裂纹、冰壳另有自己的预热，招牌卡特效在 signature/meshes.ts 自己预热。
// - 贴图：两套卡组的卡面和随从头像在加载页先画好、传到显卡（warmCardFaces，game.ts 在加载页调）。
// 新加特效时：在 REHEARSAL 里加一项（tests/presentation-warm.test.ts 会检查新的着色器材质有没有登记在这里）。
import gsap from 'gsap';
import * as THREE from 'three';
import { HIDDEN_CARD_ID, getCard } from '../../engine';
import { cardFaceTexture, portraitTexture } from '../../scene/canvasArt';
import { CardView } from '../../scene/cardView';
import { MinionView } from '../../scene/minionView';
import type { TableScene } from '../../scene/table';
import { beam } from './beam';
import { combatText } from './combatText';
import { burst, floatText, projectile, ring } from './effects';
import { Banner, BigWord, burnAway, Emblem, WARM } from './flow';
import { heroPowerWarmMeshes } from './heroPowerFx';
import { frostRing, warmIce } from './iceShell';
import { cracksOf } from './nexusCracks';
import { PRESET_NAMES, type ParticleHandle } from './particles';
import { warmScreenFx } from './screen';
import { shatterMinion } from './shatter';
import { glowCard } from './spellFx';
import { keywordStamp, shieldShatter } from './statusFx';
import { TargetArrow } from './arrow';

// 自己写着色器（ShaderMaterial、onBeforeCompile、粒子材质、菲涅尔材质）的文件，各自在哪里预热。
// tests/presentation-warm.test.ts 扫 src 下所有这样的文件：新文件没登记在这里就失败，提醒补预热。
// 值的写法（用英文：这里的字符串会被字体子集扫描当成界面文字）：rehearsal:<REHEARSAL 的项>、in-scene（开局就在场景里，
// 第一帧本来就画）、或者写明哪个函数负责
export const WARM_COVERAGE: Record<string, string> = {
  'src/presentation/fx/arc.ts': 'rehearsal:arcs',
  'src/presentation/fx/heroPowerFx.ts': 'rehearsal:heroPower',
  'src/presentation/fx/iceShell.ts': 'rehearsal:minion + warmIce (textures)',
  'src/presentation/fx/materials.ts': 'rehearsal:minion (shield shell, shards); nexus lamps: in-scene',
  'src/presentation/fx/particles/material.ts': 'particles: WARM_PARTICLES',
  'src/presentation/fx/particles/system.ts': 'particles: WARM_PARTICLES',
  'src/presentation/fx/screen.ts': 'warmScreenFx',
  'src/presentation/fx/spellFx.ts': 'rehearsal:cards (spell showcase glow)',
  'src/presentation/fx/statusFx.ts': 'rehearsal:minion (shield shards)',
  'src/presentation/signature/meshes.ts': 'warmSignatureFx (signature/meshes.ts)',
  'src/scene/boardProps.ts': 'in-scene',
  'src/scene/groundMaterial.ts': 'in-scene',
  'src/scene/minionView.ts': 'rehearsal:minion',
  'src/scene/nexusLamps.ts': 'in-scene',
};

// 彩排里发哪些粒子预设：全部
export const WARM_PARTICLES: readonly string[] = PRESET_NAMES;

// 彩排放在台面下面（被台面挡住，但在镜头视野里，所以会真的画），再缩到千分之一，连不做深度测试的飘字、箭头也看不见
const SPOT = new THREE.Vector3(0, -2, 0);
const TINY = 0.001;

type Rehearsal = { g: THREE.Group; scene: TableScene; at: () => { x: number; y: number; z: number } };

// 每一项建一种特效物件，返回要在拆掉时收尾的时间线（建出来的物件都挂在 r.g 下面）
export const REHEARSAL: Record<string, (r: Rehearsal) => gsap.core.Timeline[] | void> = {
  // 手牌、对方手牌（牌背）、英雄卡（冠饰）、法术卡；发光边、换牌叉号；法术展示的卡面发光；爆牌的燃烧（裁切平面变体）
  cards: (r) => {
    const ids = ['neutral.ancient_krug', 'ionia.recall', 'ionia.zed', HIDDEN_CARD_ID];
    const cards = ids.filter((id) => id === HIDDEN_CARD_ID || safeCard(id)).map((id, i) => new CardView(-100 - i, id));
    for (const c of cards) {
      c.setHighlight(true);
      c.setMarked(true);
      r.g.add(c);
    }
    if (cards[1]) glowCard(cards[1], 'fire', 0.001);
    const burning = cards[0];
    return burning ? [burnAway(burning, 1)] : [];
  },
  // 场上随从：嘲讽、圣盾、潜行、冻结、能攻击描边、关键词图标；碎裂、破盾、潜行图标盖章
  minion: (r) => {
    const m = new MinionView(
      { instanceId: -200, cardId: 'neutral.ancient_krug', attack: 1, health: 1, maxHealth: 3, keywords: ['taunt', 'divine_shield', 'stealth', 'poisonous'], frozen: true, silenced: false },
      0,
    );
    m.setHighlight('attack');
    r.g.add(m);
    const m2 = new MinionView({ instanceId: -201, cardId: 'neutral.ancient_krug', attack: 1, health: 1, maxHealth: 1, keywords: ['divine_shield', 'stealth'], frozen: false, silenced: false }, 1);
    m2.setHighlight('target');
    r.g.add(m2);
    shatterMinion(r.g, m2, { pieces: 3, speed: 0, up: 0, gravity: 0, spin: 0, duration: 0.5, fade: 0.1, brightness: 0.6 });
    shieldShatter(r.g, m2, 0.5, 0);
    keywordStamp(m, 'stealth', m.keywordCell('stealth'), 'in', 0.5);
  },
  // 飘字、光圈、飞弹、光点、战斗飘字、霜纹
  effects: (r) => [
    floatText(r.g, r.at, '0', 0xffffff),
    ring(r.g, r.at, 0xffffff),
    projectile(r.g, r.at, r.at, 0xffffff),
    burst(r.g, r.at, 0xffffff, 4),
    combatText(r.g, r.at, '-1', 0xff3b30, 'small', 0.5),
    frostRing(r.g, r.at(), 1, 0.5),
  ],
  // 触发光线、玩家拖的目标箭头
  arcs: (r) => {
    const arrow = new TargetArrow();
    r.g.add(arrow);
    arrow.start({ x: 0, y: 0, z: 0 }, 'damage', { frequency: 6, damping: 0.7 });
    arrow.aimAt({ x: 2, y: 0, z: -2 }, 'target', { at: { x: 2, y: 0, z: -2 }, size: 1 });
    arrow.tick(1 / 60, r.scene.stage.camera);
    return [beam(r.g, r.scene.stage.camera, r.at, () => ({ x: 2, y: 0, z: -2 })).tl];
  },
  // 开局的先后手徽记、回合横幅、胜负大字
  flow: (r) => {
    const s = r.scene.stage;
    // 这几样建好时是藏着的，要显示出来才会画
    for (const x of [new Emblem(s, r.g, { x: 0, y: 0, z: 0 }, '1', s.reflections), new Banner(s, r.g, { x: 0, y: 0, z: 0 }, '1', WARM), new BigWord(s, r.g, { x: 0, y: 0, z: 0 }, '1', 0xffd070, 0xffc44d)]) {
      x.group.visible = true;
    }
  },
  // 英雄技能的亮图标、发光层、斧刃、冰晶箭
  heroPower: (r) => {
    r.g.add(...heroPowerWarmMeshes());
  },
};

function safeCard(id: string): boolean {
  try {
    getCard(id);
    return true;
  } catch {
    return false;
  }
}

// 地址带 ?nowarm=1 时不做彩排和卡面预先上传（只用来量前后对比，见 NOTES.md）
const NOWARM = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nowarm');

export function warmCombatFx(scene: TableScene): void {
  warmScreenFx(scene);
  for (const h of scene.heroes) cracksOf(h).warm(scene.stage.renderer, scene.stage.camera, scene.stage.scene);
  warmIce(scene.stage.renderer, scene.stage.reflections);
  if (!NOWARM) rehearse(scene);
}

// 彩排：建好、画一帧、第二帧藏起来
function rehearse(scene: TableScene): void {
  if (!scene.stage?.onFrame) return; // 测试里的假场景
  const g = new THREE.Group();
  g.position.copy(SPOT);
  g.scale.setScalar(TINY);
  scene.root.add(g);
  const r: Rehearsal = { g, scene, at: () => ({ x: 0, y: 0, z: 0 }) };
  const timelines: gsap.core.Timeline[] = [];
  for (const [name, build] of Object.entries(REHEARSAL)) {
    try {
      const tls = build(r) ?? [];
      for (const t of tls) {
        t.pause();
        t.progress(0.3); // 跑到一半：时间线开头建物件的回调已经执行，物件挂在 g 下面
        timelines.push(t);
      }
    } catch (e) {
      console.warn(`[warm] ${name}`, e);
    }
  }
  // 粒子：每个预设发一次，缩到千分之一，发在台面下
  const handles: ParticleHandle[] = [];
  for (const name of PRESET_NAMES) {
    // 和 WARM_PARTICLES 是同一张表
    handles.push(scene.particles.emit(name, { at: SPOT, to: { x: SPOT.x + 0.01, y: SPOT.y, z: SPOT.z }, scale: TINY, count: 1 }));
  }
  let frames = 0;
  const unhook = scene.stage.onFrame(() => {
    if (++frames < 2) return; // 第一帧画出来（编译），第二帧开头收起
    unhook();
    // 只停、不收尾也不释放：收尾回调和释放会把这些材质销毁，three 随之释放刚编译好的程序，真用到时又要重新编译。
    // 整组藏起来留在场景里（不画、不花时间），一局结束时随场景一起释放
    for (const t of timelines) t.kill();
    for (const h of handles) h.kill();
    g.visible = false;
  });
}

// 加载页里先把两套卡组的卡面和随从头像画好、传到显卡。不然第一次抽到、第一次上场的那一帧要现画 canvas 再上传
export function warmCardFaces(renderer: THREE.WebGLRenderer, cardIds: readonly string[]): void {
  if (NOWARM) return;
  for (const id of new Set(cardIds)) {
    if (!safeCard(id)) continue;
    renderer.initTexture(cardFaceTexture(id));
    if (getCard(id).type === 'minion') renderer.initTexture(portraitTexture(id));
  }
}
