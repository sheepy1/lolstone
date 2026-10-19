// 盖伦的两张：审判、德玛西亚正义（m4-signature-fx）。共用一把德玛西亚巨剑（meshes.ts 的 makeSword）。
//
// garen.judgment 审判 · 1100ms · 重。起手（spell_cast）300。主步（damage 一组）：
// 落剑 0–200（砸）：巨剑从中央上空直落，插在敌方整排正前方，落地 dust_land 20、S1、落剑声一次重；
// 旋扫 200–600（线）：巨剑放平、高速自转，沿一条贴着敌方整排的椭圆绕两圈；每圈从左到右扫过每个随从时 spark_heavy，
//   第一圈是预告，第二圈扫过时才是该随从的命中帧（受伤飘字）；第二圈第一个命中帧 S2、棋盘闪白，命中声取一次重；
// 收尾 600–800（飘）：剑缩没消散，地面扬尘。两圈的节奏是记忆点。
//
// garen.demacian_justice 德玛西亚正义 · 1200ms · 重。起手（spell_cast）300。主步（被消灭随从的 death，带 fxId）：
// 天光 0–300（落）：圣光光柱落在目标头顶，头像被照亮；
// 落剑 300–500（砸）：巨剑从画面上方直落，砸在目标上；
// 命中帧 500：spark_heavy 24、S2、棋盘闪白、落剑重声加低频；目标走 E14 死亡，碎片从剑痕向左右两侧飞（death_shards dir toward）；
// 收尾 500–900（飘）：剑没入地面消散，光柱淡出。单体消灭比普通命中重一档，看得出"消灭"和"打死"的区别。
import gsap from 'gsap';
import * as THREE from 'three';
import type { EventOf } from '../../engine';
import { DEATH, portraitGlow } from '../animations/combat';
import type { Cue } from '../animations/types';
import { at, bigFlash, bigShake, byX, claimTurn, COLOR, discard, EASE, minionOf, place, rowZ, sfx, span, temp, towardEnemy } from './kit';
import { makeBeam, makeSword, SWORD } from './meshes';
import { prelude } from './prelude';
import type { SignatureModule } from './registry';

export const JUDGMENT = {
  drop: 0.2, // 落剑
  dropIn: 0.12, // 落剑里加速落下的那一段，落地帧
  sweep: 0.4, // 旋扫两圈
  laps: 2,
  fade: 0.2,
  dust: 20,
  spinRate: 26, // 剑自转的角速度（弧度/秒）
  depth: 0.4, // 椭圆的前后半径（槽距的比例）；剑转起来半径约 1.9，前后两段都盖得住随从
  height: 0.62, // 剑放平后离台面的高度
};

export const JUSTICE = {
  light: 0.3, // 天光
  drop: 0.2, // 落剑
  fade: 0.4, // 收尾
  sparks: 24,
  shards: 14,
};

type Dmg = EventOf<'damage'>;
type Death = EventOf<'death'>;

const STEEL_GLOW = 0x9fd0ff; // 审判：钢蓝
const HOLY_GLOW = 0xffe08a; // 德玛西亚正义：圣光金

// 巨剑整体缩放（剑尖在原点、剑身朝 +y，总长约 4.4）
const swordLength = () => SWORD.blade + 0.17 + 0.66 + 0.25;

export const judgment: SignatureModule = (c) => {
  if (c.events[0]!.kind === 'spell_cast') return prelude(c, { color: STEEL_GLOW, preset: 'slash_trail', count: 18, scale: 0.8, sounds: ['spell.physical', 'hero_power.demacia'] });
  const J = JUDGMENT;
  const { scene } = c;
  const t = gsap.timeline();
  const cues: Cue[] = [];
  const dmg = c.events.filter((e): e is Dmg => e.kind === 'damage');
  if (dmg.length === 0) return { tl: t };
  const down = claimTurn(scene);
  const foe = dmg[0]!.target.side;
  const row = rowZ(scene, foe);
  const toUs = -towardEnemy(scene, dmg[0]!.source.side);
  const list = byX(scene, dmg);
  const xs = list.map((x) => x.p.x);
  const half = Math.max(1.6, (Math.max(...xs) - Math.min(...xs)) / 2 + 1.3);
  const mid = (Math.max(...xs) + Math.min(...xs)) / 2;
  // 落剑点：整排正前方（靠我方一侧）
  const plant = { x: mid, z: row + toUs * 1.0 };
  const tSweep = J.drop;
  const tFade = tSweep + J.sweep;
  const tEnd = tFade + J.fade;
  const L = swordLength();

  // 剑：外层 pivot 管位置和自转，里层 holder 管"竖着插地"还是"放平"
  const pivot = temp(scene, t, 0, tEnd, () => {
    const g = new THREE.Group();
    const holder = new THREE.Group();
    holder.name = 'holder';
    const sw = makeSword(scene, STEEL_GLOW);
    sw.group.name = 'sword';
    holder.add(sw.group);
    g.add(holder);
    return g;
  }, (g) => {
    g.position.set(plant.x, 7, plant.z);
    g.scale.setScalar(0.85);
  });
  const holder = () => pivot.get()?.getObjectByName('holder') ?? null;
  // 落剑：竖直落下插地
  at(t, 0, () => {
    const g = pivot.get();
    if (g) gsap.to(g.position, { y: 0.05, duration: J.dropIn, ease: EASE.smash });
  });
  at(t, J.dropIn, () => {
    scene.particles.emit('dust_land', { at: { x: plant.x, y: 0, z: plant.z }, count: J.dust });
    scene.particles.emit('spark_heavy', { at: { x: plant.x, y: 0.2, z: plant.z }, count: 10 });
    sfx('combat.hit_heavy', plant.x);
    sfx('combat.hero_hit', plant.x);
    bigShake(scene, 1, down);
    const g = pivot.get();
    if (g) gsap.fromTo(g.rotation, { z: 0.06 }, { z: 0, duration: J.drop - J.dropIn + 0.05, ease: EASE.settle });
  });
  // 旋扫：剑翻成水平（剑身中心对在 pivot 上），沿椭圆从左到右扫过整排，从后面绕回来，两圈
  const lapPos = (phi: number) => ({ x: mid - half * Math.cos(phi), z: row + toUs * J.depth * 1.95 * Math.sin(phi) });
  // phi 在 (0, π) 时在整排前沿上从左到右扫；(π, 2π) 从后面绕回左边
  const sweep = { phi: 0, spin: 0 };
  at(t, tSweep - 0.02, () => {
    const h = holder();
    if (!h) return;
    const sw = h.getObjectByName('sword')!;
    gsap.to(h.rotation, { z: Math.PI / 2, duration: 0.06, ease: EASE.land });
    gsap.to(sw.position, { y: -L / 2 + 0.6, duration: 0.06, ease: EASE.land });
    const g = pivot.get();
    if (g) gsap.to(g.position, { y: J.height, duration: 0.06, ease: EASE.land });
  });
  t.to(sweep, {
    phi: Math.PI * 2 * J.laps,
    spin: J.spinRate * J.sweep,
    duration: J.sweep,
    ease: EASE.line,
    onUpdate: () => {
      const g = pivot.get();
      if (!g) return;
      const p = lapPos(sweep.phi);
      g.position.x = p.x;
      g.position.z = p.z;
      g.rotation.y = sweep.spin;
    },
  }, tSweep);
  at(t, tSweep - 0.05, () => sfx('combat.swing', mid));
  at(t, tSweep + J.sweep / 2 - 0.05, () => sfx('combat.swing', mid));
  // 剑扫过的拖尾
  at(t, tSweep, () => {
    const g = pivot.get();
    if (!g) return;
    const tip = () => ({ x: g.position.x + Math.cos(g.rotation.y) * 1.7, y: J.height, z: g.position.z - Math.sin(g.rotation.y) * 1.7 });
    const tail = () => ({ x: g.position.x - Math.cos(g.rotation.y) * 1.7, y: J.height, z: g.position.z + Math.sin(g.rotation.y) * 1.7 });
    scene.particles.emit('slash_trail', { at: tip(), follow: tip, count: 60, color: STEEL_GLOW });
    scene.particles.emit('slash_trail', { at: tail(), follow: tail, count: 60, color: 0xffffff });
  });
  // 扫过每个随从的时刻：x = mid - half·cos(phi) 解出 phi，第一圈 phi，第二圈 phi + 2π
  let firstHit = Infinity;
  list.forEach(({ e, k, p }, n) => {
    const phi = Math.acos(Math.max(-1, Math.min(1, (mid - p.x) / half)));
    for (let lap = 0; lap < J.laps; lap++) {
      const tt = tSweep + ((phi + lap * Math.PI * 2) / (Math.PI * 2 * J.laps)) * J.sweep;
      const final = lap === J.laps - 1;
      at(t, tt, () => {
        scene.particles.emit('spark_heavy', { at: { x: p.x, y: 0.45, z: p.z }, count: final ? 16 : 7 });
        const m = minionOf(scene, e.target);
        if (m && !final) gsap.fromTo(m.body.rotation, { z: 0.1 }, { z: 0, duration: 0.15, ease: 'elastic.out(1, 0.4)' });
      });
      if (final) {
        firstHit = Math.min(firstHit, tt);
        place(t, cues, c.byDefault(k), tt, ['impact:hit']);
        if (n === 0) {
          at(t, tt, () => {
            bigShake(scene, 2, down);
            bigFlash(scene, COLOR.white, down);
            sfx('combat.hit_heavy', p.x); // 命中取一次重
          });
        }
      }
    }
  });
  // 收尾：剑缩没消散，地面扬尘
  at(t, tFade, () => {
    const g = pivot.get();
    if (!g) return;
    gsap.to(g.scale, { x: 0.01, y: 0.01, z: 0.01, duration: J.fade, ease: EASE.hide });
    gsap.to(g.position, { y: J.height + 0.6, duration: J.fade, ease: EASE.show });
    scene.particles.emit('dust_land', { at: { x: g.position.x, y: 0, z: g.position.z }, count: 12 });
    scene.particles.emit('slash_trail', { at: { x: g.position.x, y: J.height, z: g.position.z }, count: 16, color: STEEL_GLOW });
  });
  span(t, tEnd);
  const lastHit = Math.max(firstHit, ...list.map(({ p }) => tSweep + ((Math.acos(Math.max(-1, Math.min(1, (mid - p.x) / half))) + (J.laps - 1) * Math.PI * 2) / (Math.PI * 2 * J.laps)) * J.sweep));
  return { tl: t, cues, tail: Math.max(0, t.duration() - lastHit), hitAt: firstHit };
};

export const demacianJustice: SignatureModule = (c) => {
  if (c.events[0]!.kind === 'spell_cast') return prelude(c, { color: HOLY_GLOW, preset: 'holy_pillar', count: 10, scale: 0.5, sounds: ['spell.holy'] });
  const J = JUSTICE;
  const { scene } = c;
  const t = gsap.timeline();
  const cues: Cue[] = [];
  const deaths = c.events.filter((e): e is Death => e.kind === 'death');
  if (deaths.length === 0) return { tl: t };
  const down = claimTurn(scene);
  const e = deaths[0]!;
  const p = scene.pointOf(e.target);
  const m = minionOf(scene, e.target);
  const tDrop = J.light;
  const tHit = tDrop + J.drop;
  const tEnd = tHit + J.fade;

  // 天光：光柱从上往下落到目标头顶，holy_pillar 粒子，头像被照亮
  const beam = temp(scene, t, 0, tEnd, () => makeBeam(0.85, 9, COLOR.light), (b) => {
    b.position.set(p.x, 0, p.z);
  });
  const bk = { o: 0, s: 0.4, time: 0 };
  const applyBeam = () => {
    const b = beam.get();
    if (!b) return;
    b.material.uniforms.uOpacity!.value = bk.o;
    b.material.uniforms.uTime!.value = bk.time;
    b.scale.x = b.scale.z = 0.95 * bk.s;
  };
  t.to(bk, { o: 1, s: 1, duration: J.light, ease: EASE.land, onUpdate: applyBeam }, 0);
  // 剑落下时光柱让一让，不然剑整个藏在光里看不见
  t.to(bk, { o: 0.4, duration: J.drop * 0.6, ease: EASE.land, onUpdate: applyBeam }, tDrop);
  t.to(bk, { time: 3, duration: tEnd, ease: 'none', onUpdate: applyBeam }, 0);
  t.to(bk, { o: 0, s: 1.4, duration: J.fade, ease: EASE.hide, onUpdate: applyBeam }, tHit);
  at(t, 0, () => {
    sfx('spell.holy', p.x);
    scene.particles.emit('holy_pillar', { at: { x: p.x, y: 0, z: p.z } });
    if (m) portraitGlow(m, COLOR.light, 1.2, J.light + J.drop + 0.1, 'power1.in');
  });
  // 落剑：巨剑从画面上方直落，砸进目标
  const holder: { g: THREE.Group | null } = { g: null };
  at(t, tDrop, () => {
    const sw = makeSword(scene, HOLY_GLOW);
    const g = new THREE.Group();
    g.add(sw.group);
    g.position.set(p.x, 9, p.z - 0.15);
    g.rotation.set(-0.12, 0.35, 0);
    scene.layers.fx.add(g);
    holder.g = g;
    gsap.to(g.position, { y: -0.35, duration: J.drop, ease: EASE.smash });
  });
  // 命中帧：目标从这一刻起走 E14（定格提前 80ms 开始，碎裂正好落在命中帧上）
  place(t, cues, c.byDefault(0), tHit - DEATH.freeze);
  at(t, tHit, () => {
    scene.particles.emit('spark_heavy', { at: { x: p.x, y: 0.4, z: p.z }, count: J.sparks });
    scene.particles.emit('dust_land', { at: { x: p.x, y: 0, z: p.z }, count: 14 });
    for (const s of [-1, 1]) {
      scene.particles.emit('death_shards', { at: { x: p.x, y: 0.3, z: p.z }, to: { x: p.x + s * 3, y: 0.6, z: p.z }, dir: 'toward', count: J.shards, color: 0xd8c08a });
    }
    bigShake(scene, 2, down);
    bigFlash(scene, COLOR.white, down);
    sfx('combat.hit_heavy', p.x);
    sfx('combat.hero_hit', p.x); // 低频
  });
  // 收尾：剑没入地面、缩小消散
  at(t, tHit + 0.08, () => {
    const g = holder.g;
    if (!g) return;
    gsap.to(g.position, { y: -2.2, duration: J.fade - 0.08, ease: EASE.hide });
    gsap.to(g.scale, { x: 0.3, y: 0.3, z: 0.3, duration: J.fade - 0.08, ease: EASE.hide });
  });
  at(t, tEnd, () => {
    if (holder.g) discard(holder.g);
    holder.g = null;
  });
  span(t, tEnd);
  return { tl: t, cues, tail: Math.max(0, t.duration() - tHit), hitAt: tHit };
};

