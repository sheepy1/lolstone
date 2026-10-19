// 法术演出的画面部分（m4-storyboard E06、E09、E10）。时间表在 spellPlan.ts，这里按它放粒子、发光和画面反馈。
//
// - 展示段：cardPlayed 把牌飞到中央，停的时候卡面按 fx 色发光（glowCard），停完把牌交给 spellCast（holdForCast）。
// - 溶解（100ms，起）：spellCast 接过牌（takeCast），卡面提亮、略放大再缩没，散成光点；单体法术的光飞向目标。
// - 效果：按 fx 类型，五种的区分靠颜色、粒子种类和运动方向，不靠时长：
//   fire 火焰飞弹带拖尾从中央飞向目标，命中爆开（fire_burst），棋盘闪火色；
//   frost 冰霜在目标处贴地铺开（frost_creep），铺满时冷白闪一下，接 E17 覆冰；
//   holy 光柱从天上落在目标（holy_pillar），光从卡上往上散；
//   shadow 暗影从四周聚拢、收缩，缩到最小时爆发（shadow_burst）；
//   physical 两道交叉的刀光挥过目标（slash_trail）。
// - 群体法术（E10）：每个目标同时各来一份，按横坐标错开 40ms 成波；第一个命中帧棋盘闪 fx 色、S2（有益的不震）。
// - 无目标法术：抽牌的光飞进牌库，加法力的光飞向法力条，其余在中央散开。
// 招牌卡（m4-signature-fx.md）的专属特效由招牌卡会话按 fxId 覆盖，这里是它们的兜底。
import gsap from 'gsap';
import * as THREE from 'three';
import type { Fx, Side, TargetRef } from '../../engine';
import type { CardView } from '../../scene/cardView';
import { dispose } from '../../scene/dispose';
import { CARD_FACE } from '../../scene/geometry';
import type { TableScene } from '../../scene/table';
import { CARD_H, CARD_T, CARD_W, showcaseSlot, type Vec3 } from '../layout';
import { FX_PALETTE, type PresetDef, type PresetName } from './particles';
import { boardFlash, screenShake } from './screen';
import { SPELL, type SpellPlan } from './spellPlan';
import { card_dissolve, fire_burst, frost_creep, frost_hit, light_streak, shadow_burst } from './spellPresets';

// 分镜 1.8 的 fx 色
export const SPELL_COLORS: Record<Fx, number> = {
  fire: FX_PALETTE.fire,
  frost: FX_PALETTE.ice,
  holy: FX_PALETTE.light,
  shadow: FX_PALETTE.shadow,
  physical: FX_PALETTE.physical,
};
// 卡面发光、溶解的光用的颜色：影色 #6b3fa0 太暗，叠加在卡面上几乎看不出，发光时取减益紫
const GLOW_COLORS: Record<Fx, number> = { ...SPELL_COLORS, shadow: FX_PALETTE.debuff };

// ---------- 展示段：卡面按 fx 色发光 ----------

// 卡背后一圈柔光（圆角矩形外的指数衰减，到面片边上淡到 0，不留直边）加卡面上一层很淡的同色光。加色、不写深度、不进泛光
const haloGeo = new THREE.PlaneGeometry(CARD_W * 1.6, CARD_H * 1.45);
function haloMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: 0 } },
    vertexShader: `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      varying vec2 vP;
      void main() {
        vec2 half_ = vec2(${(CARD_W / 2 - 0.12).toFixed(3)}, ${(CARD_H / 2 - 0.12).toFixed(3)});
        vec2 q = abs(vP) - half_;
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.12;
        float a = exp(-max(d, 0.0) * 9.0);
        vec2 e = ${(CARD_W * 0.8).toFixed(3)} - abs(vP) * vec2(1.0, ${((CARD_W * 0.8) / (CARD_H * 0.725)).toFixed(3)});
        a *= smoothstep(0.0, 0.35, min(e.x, e.y));
        gl_FragColor = vec4(color * a * strength, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

type Glow = { halo: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; sheen: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; color: number };
const glows = new WeakMap<CardView, Glow>();

// 卡面按 fx 色发光，duration 秒内亮起来
export function glowCard(card: CardView, fx: Fx, duration: number): void {
  const color = GLOW_COLORS[fx];
  let g = glows.get(card);
  if (!g) {
    const halo = new THREE.Mesh(haloGeo, haloMaterial(color));
    halo.position.z = -CARD_T / 2 - 0.02;
    halo.renderOrder = -1;
    const sheen = new THREE.Mesh(CARD_FACE, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    sheen.position.z = CARD_T / 2 + 0.008;
    card.body.add(halo, sheen);
    g = { halo, sheen, color };
    glows.set(card, g);
  }
  gsap.to(g.halo.material.uniforms.strength, { value: SPELL.glow * 1.6, duration, ease: 'power2.out' });
  gsap.to(g.sheen.material, { opacity: SPELL.glow * 0.18, duration, ease: 'power2.out' });
}

// ---------- 交接：cardPlayed 停完把牌交给 spellCast ----------

const held = new WeakMap<TableScene, Map<number, CardView>>();
// spellCast 一直没来取（被别的模块覆盖、或者出错）时，多久之后自己溶解掉
const ORPHAN_AFTER = 1.2;

export function holdForCast(scene: TableScene, id: number, card: CardView, fx: Fx): void {
  let m = held.get(scene);
  if (!m) held.set(scene, (m = new Map()));
  m.set(id, card);
  gsap.delayedCall(ORPHAN_AFTER, () => {
    const c = takeCast(scene, id);
    if (c) dissolveCard(scene, c, fx, null);
  });
}

// 取走展示中的牌（招牌卡的专属演出也从这里取）。没有时返回 null
export function takeCast(scene: TableScene, id: number): CardView | null {
  const m = held.get(scene);
  const c = m?.get(id) ?? null;
  m?.delete(id);
  return c;
}

// 把 child 放到 t 的第 at 秒。child 超出 t 的长度 end 时不并进 t：先暂停，到时刻再单独播（见 spellPlan 的 stepEnd）。
// 单独播的仍然挂在全局时间线上，跟着快进和慢放走，换局时一起停掉
export function addOrSpill(t: gsap.core.Timeline, child: gsap.core.Timeline, at: number, end: number): void {
  if (at + child.duration() <= end + 1e-6) {
    t.add(child, at);
    return;
  }
  child.pause(0);
  t.call(() => void child.play(0), undefined, at);
}

// ---------- 溶解 ----------

const ground = (p: Vec3): Vec3 => ({ x: p.x, y: 0, z: p.z });

function emit(scene: TableScene, preset: PresetName | PresetDef, opts: Parameters<TableScene['particles']['emit']>[1]) {
  return scene.particles.emit(preset, opts);
}

// 卡面提亮、放大到 1.12 再缩没（起），散成 fx 色的光点。dir 是光点散开的方向（光柱的光往上散）
export function dissolveCard(scene: TableScene, card: CardView | null, fx: Fx, dir: 'out' | 'up' | null): gsap.core.Timeline {
  const t = gsap.timeline();
  const show = showcaseSlot();
  const D = SPELL.dissolve;
  t.call(() => {
    const at = card ? card.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(show.pos.x, show.pos.y, show.pos.z);
    emit(scene, card_dissolve, { at, color: GLOW_COLORS[fx], ...(dir === 'up' ? { dir: 'up' } : {}) });
  });
  if (!card) return t.to({}, { duration: D });
  const s = card.scale.x;
  const g = glows.get(card);
  if (g) {
    t.to(g.sheen.material, { opacity: 0.55, duration: D * 0.4, ease: 'power2.out' }, 0);
    t.to(g.halo.material.uniforms.strength, { value: SPELL.glow * 4, duration: D * 0.4, ease: 'power2.out' }, 0);
  }
  t.to(card.scale, { x: s * 1.12, y: s * 1.12, z: s * 1.12, duration: D * 0.4, ease: 'power2.out' }, 0);
  t.to(card.scale, { x: s * 0.02, y: s * 0.02, z: s * 0.02, duration: D * 0.6, ease: 'power3.in' }, D * 0.4);
  t.call(() => dispose(card), undefined, D);
  return t;
}

// ---------- 效果 ----------

// 物理挥砍的两道刀光：从左上挥到右下、从右上挥到左下，交叉在目标中心
const SLASHES: [Vec3, Vec3][] = [
  [{ x: -0.95, y: 0.55, z: -0.35 }, { x: 0.95, y: -0.15, z: 0.35 }],
  [{ x: 0.95, y: 0.55, z: -0.35 }, { x: -0.95, y: -0.15, z: 0.35 }],
];
const add = (p: Vec3, d: Vec3): Vec3 => ({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });

// 一个目标上的效果。hit 是这个目标的命中帧（相对时间线开头）；from 是飞弹的出发点
function effectOn(t: gsap.core.Timeline, scene: TableScene, plan: SpellPlan, ref: TargetRef, hit: number, from: Vec3): void {
  const color = SPELL_COLORS[plan.fx];
  const k = plan.shape === 'group' ? SPELL.groupScale : SPELL.scale;
  const p = () => scene.pointOf(ref);
  const streak = () => emit(scene, light_streak, { at: from, to: p(), color: GLOW_COLORS[plan.fx], duration: SPELL.dissolve });
  // 这个目标的效果段从哪一秒开始：溶解结束再加上它在波里的错开
  const start = SPELL.dissolve + (hit - plan.hit);
  switch (plan.fx) {
    case 'fire':
      t.call(() => emit(scene, 'fire_bolt', { at: from, to: p(), duration: SPELL.fire.travel, scale: k }), undefined, hit - SPELL.fire.travel);
      t.call(
        () => {
          if (plan.harmful) emit(scene, fire_burst, { at: ground(p()), scale: k });
          else emit(scene, 'spark_light', { at: p(), color, count: 10, scale: k });
        },
        undefined,
        hit,
      );
      return;
    case 'frost':
      t.call(streak, undefined, start - SPELL.dissolve);
      t.call(() => emit(scene, frost_creep, { at: ground(p()), scale: k }), undefined, start);
      t.call(() => emit(scene, frost_hit, { at: ground(p()), scale: k }), undefined, hit);
      return;
    case 'holy':
      t.call(() => emit(scene, 'holy_pillar', { at: ground(p()), count: plan.shape === 'group' ? 18 : 30, scale: Math.min(k, 1.2) }), undefined, hit - SPELL.holy.land);
      return;
    case 'shadow':
      t.call(streak, undefined, start - SPELL.dissolve);
      t.call(() => emit(scene, 'shadow_gather', { at: ground(p()), scale: k, count: 22 }), undefined, hit - SPELL.shadow.gather - SPELL.shadow.shrink + 0.02);
      t.call(() => emit(scene, shadow_burst, { at: ground(p()), scale: plan.harmful ? k : k * 0.6 }), undefined, hit);
      return;
    case 'physical': {
      t.call(streak, undefined, start - SPELL.dissolve);
      const half = SPELL.physical.slash / 2;
      SLASHES.forEach(([a, b], i) => {
        t.call(() => emit(scene, 'slash_trail', { at: add(p(), a), to: add(p(), b), duration: SPELL.physical.slash, count: 16, scale: k }), undefined, hit - half + i * SPELL.physical.second);
      });
      return;
    }
  }
}

// 无目标法术：溶解的光飞向牌库（抽牌）或法力条（加法力），到达是命中帧；其余在中央散一圈
function noTargetEffect(t: gsap.core.Timeline, scene: TableScene, plan: SpellPlan, side: Side, from: Vec3): void {
  const color = GLOW_COLORS[plan.fx];
  const dest = (): Vec3 | null => {
    if (plan.noTarget === 'draw') return scene.deckPoint(side);
    if (plan.noTarget === 'mana') {
      const bar = scene.mana[side];
      return bar.gemPoint(Math.min(9, scene.view.players[side].mana.max));
    }
    return null;
  };
  const travel = SPELL.noTarget.travel;
  t.call(
    () => {
      const to = dest();
      if (to) emit(scene, light_streak, { at: from, to, color, duration: travel, count: 20 });
      else emit(scene, 'buff_ring', { at: { x: 0, y: 0, z: 0.6 }, color, scale: 1.4 });
    },
    undefined,
    SPELL.dissolve,
  );
  t.call(
    () => {
      const to = dest();
      if (to) emit(scene, 'spark_light', { at: to, color, count: 8 });
    },
    undefined,
    plan.hit,
  );
}

// 整个效果段。hits[i] 是 plan.targets[i] 的命中帧
export function spellEffect(scene: TableScene, plan: SpellPlan, side: Side, hits: readonly number[]): gsap.core.Timeline {
  const t = gsap.timeline();
  const show = showcaseSlot().pos;
  const from: Vec3 = { x: show.x, y: show.y - 0.3, z: show.z };
  if (plan.shape === 'none' && plan.targets.length === 0) {
    noTargetEffect(t, scene, plan, side, from);
    if (plan.harmful) t.call(() => boardFlash(scene, SPELL_COLORS[plan.fx]), undefined, plan.hit);
    return t;
  }
  plan.targets.forEach((ref, i) => effectOn(t, scene, plan, ref, hits[i], from));
  const first = Math.min(...hits);
  const color = SPELL_COLORS[plan.fx];
  if (plan.shape === 'group') {
    // E10：第一个命中帧棋盘闪 fx 色、S2；后面接群体冻结时由冻结那组闪冰色（一组只闪一次）。有益的群体法术不震
    t.call(
      () => {
        if (!plan.freezesAll) boardFlash(scene, color);
        if (plan.harmful) screenShake(scene, 2);
      },
      undefined,
      first,
    );
  } else if (plan.harmful) {
    // E09：火焰命中棋盘闪火色；伤害 ≥ 4 打在随从上 S1（打英雄的震屏归 E24）
    const minion = plan.targets[0].kind === 'minion';
    t.call(
      () => {
        if (plan.fx === 'fire') boardFlash(scene, color);
        if (minion && plan.amount >= SPELL.heavyAt) screenShake(scene, 1);
      },
      undefined,
      first,
    );
  }
  return t;
}

