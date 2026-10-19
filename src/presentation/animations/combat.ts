// 战斗事件（m4-storyboard E11 到 E19、E24）的参数和共用小工具。参数都集中在这里，调试台 /dev/fx 的"战斗"面板可以现场调；
// 试出满意的值后改这里的默认值。时长单位秒，尺寸按分镜 1.3 的单位写，用 UNIT 换算成世界单位。
import gsap from 'gsap';
import * as THREE from 'three';
import { playSfx, type SfxId } from '../../audio';
import type { TargetRef } from '../../engine';
import { MINION_TOP } from '../../scene/geometry';
import type { MinionView } from '../../scene/minionView';
import type { TableScene } from '../../scene/table';
import { MINION_HEIGHT, MINION_SIZE, NEXUS, type Vec3 } from '../layout';
import type { ShakeLevel } from '../fx/screen';
import { screenShake } from '../fx/screen';
import { keywordStamp, shieldGain, stealthFadeIn } from '../fx/statusFx';
import type { Cue } from './types';

// 分镜 1.3 的尺寸单位：底座高是随从底座在画面上的高度（正方形底座的边长），槽距是相邻两个随从中心的距离
export const UNIT = { base: MINION_SIZE, slot: 1.95, nexus: 2.2 };

// E11 攻击
export const ATTACK = {
  windup: 0.15, // 蓄力
  windupTilt: 12, // 后仰（度）
  windupBack: 0.15, // 后退（槽距）
  windupLift: 0.1, // 抬起（底座高）
  windfuryWindup: 0.08, // 风怒第二次攻击的蓄力
  dash: 0.18, // 冲锋
  dashLift: 0.6, // 弧顶高度（底座高）
  arcPeak: 0.6, // 弧顶在冲锋的哪个位置
  dashTilt: -10, // 冲锋时前倾（度）
  stopShort: 0.3, // 停在目标前多远（槽距）
  hitY: 0.12, // 撞上时离台面的高度（世界单位）
  recover: 0.27, // 回位
  swingLead: 0.05, // 挥击声比冲锋早多少
  trail: 12, // slash_trail 数量
  landDust: 4, // 回位落地扬尘
  shakeAt: 4, // 伤害达到这个值时 S1（目标是英雄时交给 E24）
};

// E12 受伤（随从）
export const HIT = {
  shakes: 6, // 抖几次
  shakeAmp: 0.03, // 抖动幅度（底座宽）
  shakeTime: 0.16,
  redGlow: 0.6, // 头像自发光红
  redFade: 0.24, // 泛红消退
  badgeScale: 1.25, // 生命徽章弹到
  badgeTime: 0.18,
  badgeFlash: 0.12, // 徽章闪红
  textAbove: 0.3, // 飘字从徽章上方多高出现（底座高）
  textRise: 0.5, // 上升多高（底座高）
  sparkLight: 8, // 法术等非攻击伤害的火花：≤ 2 轻
  sparkHeavy: 14, // ≥ 3 重
  heavyAt: 3, // 命中声和火花换重的伤害
  lowAt: 5, // 再叠一层低频的伤害
  stagger: 0.04, // 同组多目标错开
};

// E24 英雄受伤
export const HERO_HIT = {
  jitter: 0.02, // 枢纽抖动幅度（枢纽宽）
  jitterTime: 0.2,
  portraitRed: 0.6,
  crackFlash: 0.15, // 裂纹红光闪
  midAt: 3, // S1
  heavyAt: 5, // S2、边缘泛红、水晶碎片
  sparks: 16,
  shards: 6,
};

// E13 治疗
export const HEAL = {
  glow: 0.3, // 头像绿色自发光
  glowFade: 0.3,
  motes: 12,
  stagger: 0.04,
  tail: 0.28, // 收尾时长（分镜 1.7 组间重叠）：命中帧之后 120ms 以外都算
};

// E14 随从死亡
export const DEATH = {
  freeze: 0.08, // 定格
  greyBrightness: 0.6, // 定格时头像亮度
  shatter: 0.35, // 碎裂
  pieces: 3, // 碎块按 n × n 切（9 块，分镜 6 到 10 块）
  pieceSpeed: 2.2, // 碎块向外飞的速度
  pieceUp: 2.6, // 向上的初速度
  gravity: 14,
  spin: 9, // 碎块翻滚角速度上限（弧度/秒）
  fade: 0.22, // 碎裂后淡出（不占这一步的时长）
  sparks: 6,
  closeAt: 0.25, // 合拢从碎裂的这个时刻开始
  close: 0.27, // 合拢
  voiceDelay: 0.12,
  stagger: 0.05,
};

// E18 圣盾
export const SHIELD = {
  gainTime: 0.2, // 获得：外壳 0 → 1.08 → 1
  gainOver: 1.08,
  ringFlash: 0.15,
  breakCount: 18,
  shardTime: 0.25, // 外壳碎片飞散
  shardSpeed: 2.4,
  whiteFlash: 0.06,
};

// E17 冻结、解冻
// E17 冻结、解冻（2026-10-20 按用户反馈重做：冰棱一根根长出来，比分镜的 500ms 长一点，见 NOTES.md）
export const FREEZE = {
  spreadCount: 16, // frost_spread 粒子
  ring: 0.7, // 台面上的霜纹扩散
  ringRadius: 1.7,
  growAt: 0.1, // 冰棱开始长
  grow: 0.45, // 冰棱全部长完（一根根错开）
  flashAt: 0.55, // 冰晶闪光
  flash: 0.22,
  total: 0.7,
  shakes: 2, // 结冰时底座抖两下
  shakeTime: 0.08,
  shakeAmp: 0.025, // 底座宽
  crack: 0.15, // 解冻：裂纹亮起
  shatter: 0.5, // 解冻：碎成冰片飞散、落地消融
  thawShatter: 14, // 解冻碎冰粒子
  thawTotal: 0.65,
  stagger: 0.04,
};

// E19 潜行
export const STEALTH = {
  enterSmoke: 10,
  enterSwirl: 0.3,
  opacity: 0.55, // 潜行时头像透明度
  enterFade: 0.25,
  leaveSmoke: 6,
  leaveFade: 0.15,
};

// E15、E16 增益、减益、沉默
export const BUFF = {
  ring: 0.3, // buff_ring 绕一圈
  glow: 0.3, // 头像金色自发光
  glowFade: 0.3,
  debuffDim: 0.5, // 减益时头像亮度
  debuffBack: 0.15,
  gather: 8, // shadow_gather 数量
  gatherTime: 0.2,
  strip: 0.1, // 沉默时状态收缩消失
  stagger: 0.04,
  tail: 0.28, // 增益的收尾时长（分镜 1.7 组间重叠）：命中帧之后 120ms 以外都算
  silenceTail: 0.25,
};

// ---------- 声音 ----------

// 声像：按物件横坐标换算，棋盘两端约 ±0.8
export function panAt(x: number): number {
  return Math.max(-1, Math.min(1, x / 8));
}

export function sfxAt(id: SfxId, x: number): void {
  playSfx(id, { pan: panAt(x) });
}

// 命中声的 cue：同一步只播最重的一次（分镜 1.6：≤ 2 轻、≥ 3 重、≥ 5 再叠低频层 combat.hit_low）。
export function hitCue(at: number, amount: number, x: () => number, hero = false): Cue {
  const ids: SfxId[] = hero
    ? amount >= HIT.lowAt ? ['combat.hero_hit', 'combat.hit_low'] : ['combat.hero_hit']
    : amount >= HIT.lowAt ? ['combat.hit_heavy', 'combat.hit_low'] : amount >= HIT.heavyAt ? ['combat.hit_heavy'] : ['combat.hit_light'];
  return { channel: 'impact:hit', at, weight: amount + (hero ? 0.5 : 0), run: () => ids.forEach((id) => sfxAt(id, x())) };
}

export function shakeCue(scene: TableScene, at: number, level: ShakeLevel): Cue {
  return { channel: 'shake', at, weight: level, run: () => screenShake(scene, level) };
}

// ---------- 物件 ----------

// 随从顶面的头像材质（按几何体找，不依赖 MinionView 的私有字段）
export function portraitMesh(m: MinionView): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null {
  let found: THREE.Mesh | null = null;
  m.body.traverse((o) => {
    if (!found && (o as THREE.Mesh).geometry === MINION_TOP) found = o as THREE.Mesh;
  });
  return found as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
}

// 头像自发光一下再退（受伤红、治疗绿、增益金）
export function portraitGlow(m: MinionView | undefined, color: number, peak: number, fade: number, ease = 'power2.out'): void {
  const mat = m && portraitMesh(m)?.material;
  if (!mat || !('emissive' in mat)) return;
  gsap.killTweensOf(mat, 'emissiveIntensity');
  mat.emissive.setHex(color);
  gsap.fromTo(mat, { emissiveIntensity: peak }, { emissiveIntensity: 0, duration: fade, ease });
}

// 物件的抖动（受伤、覆冰）。攻击动画正在驱动这个物件时（userData.driven），只写偏移量，由攻击动画加进去；
// 否则直接改 x、z（静止时 body 在原点）。
export function jitter(body: THREE.Object3D, amp: number, times: number, duration: number): gsap.core.Timeline {
  const t = gsap.timeline();
  const off = (body.userData.jitter ??= { x: 0, z: 0 }) as { x: number; z: number };
  const write = (x: number, z: number) => {
    if (!body.userData.driven) body.position.set(body.position.x - off.x + x, body.position.y, body.position.z - off.z + z);
    off.x = x;
    off.z = z;
  };
  const step = duration / times;
  for (let i = 0; i < times; i++) {
    const a = Math.random() * Math.PI * 2;
    const k = amp * (1 - i / times);
    t.call(() => write(Math.cos(a) * k, Math.sin(a) * k), undefined, i * step);
  }
  t.call(() => write(0, 0), undefined, duration);
  return t;
}

// 目标在画面上的横坐标（同组错开、声像用）
export function targetX(scene: TableScene, ref: TargetRef): number {
  return scene.pointOf(ref).x;
}

// 生命徽章上方的点（飘字出现的位置）。随从按它的槽位算，不跟着 body：攻击方撞上目标时受的反击伤害，飘字留在它自己的槽位上方。
// "上方"是画面上的上方：往上抬，同时往远处挪一点，不盖住徽章本身
export function badgePoint(scene: TableScene, ref: TargetRef): Vec3 {
  if (ref.kind === 'hero') {
    const h = scene.heroes[ref.side];
    return { x: h.position.x + NEXUS.hpPos.x + 0.55, y: NEXUS.hpPos.y + 0.3, z: h.position.z + NEXUS.hpPos.z - 0.45 };
  }
  const m = scene.minion(ref.instanceId);
  const p = m ? m.position : scene.pointOf(ref);
  return { x: p.x + 0.44, y: MINION_HEIGHT + 0.1, z: p.z + 0.1 };
}

// 动画里的一段空白（让时间线占住一段时长）
export function hold(t: gsap.core.Timeline, seconds: number, at?: number | string): void {
  t.to({}, { duration: seconds }, at);
}

// ---------- 状态进入 ----------

// 随从获得潜行、圣盾、嘲讽时的进入表现（E18 获得、E19 进入）。调用前显示局面已经同步，常驻状态已经可见。
// 增益事件和随从入场都用它：入场时带着这些关键词的随从落地后播一遍。
export function statusEnter(scene: TableScene, id: number, keywords: readonly string[]): void {
  const m = scene.minion(id);
  if (!m) return;
  const p = scene.pointOf({ side: m.side, kind: 'minion', instanceId: id });
  if (keywords.includes('stealth')) {
    sfxAt('combat.stealth', p.x);
    scene.particles.emit('stealth_smoke', { at: { x: p.x, y: 0, z: p.z }, count: STEALTH.enterSmoke });
    stealthFadeIn(m, STEALTH.enterFade);
    keywordStamp(m, 'stealth', m.keywordCell('stealth'), 'in', STEALTH.enterFade);
  }
  if (keywords.includes('divine_shield')) shieldGain(m, SHIELD.gainTime, SHIELD.gainOver, SHIELD.ringFlash);
  if (keywords.includes('taunt')) gsap.fromTo(m.tauntRim.scale, { x: 1.35, y: 1, z: 1.35 }, { x: 1, y: 1, z: 1, duration: 0.25, ease: 'back.out(1.4)' });
}

// 头像压暗再回到原来的亮度（减益、沉默）。原来的亮度带着召唤失调之类的色调，所以先记下来再回去
export function dimPortrait(m: MinionView | undefined, dim: number, back: number, delay = 0): void {
  const mat = m && portraitMesh(m)?.material;
  if (!mat) return;
  const c0 = mat.color.clone();
  gsap.fromTo(mat.color, { r: c0.r * dim, g: c0.g * dim, b: c0.b * dim }, { r: c0.r, g: c0.g, b: c0.b, duration: back, delay, ease: 'power2.out' });
}
