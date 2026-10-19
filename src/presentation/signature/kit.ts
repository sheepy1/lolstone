// 招牌特效共用的小工具：缓动代号、分量降档、画面反馈、临时物件的生命周期、坐标。
// 时长单位秒，尺寸按分镜 1.3 的单位（UNIT）换算。
import gsap from 'gsap';
import * as THREE from 'three';
import { playSfx, type SfxId } from '../../audio';
import type { Side, TargetRef } from '../../engine';
import type { MinionView } from '../../scene/minionView';
import type { TableScene } from '../../scene/table';
import { panAt } from '../animations/combat';
import type { Anim, Cue } from '../animations/types';
import type { PresentationEvent } from '../events';
import { boardFlash, SCREEN, screenShake, type ShakeLevel } from '../fx/screen';
import { boardRowZ, type Vec3 } from '../layout';

// 分镜 1.3 的缓动代号
export const EASE = {
  rise: 'power3.in', // 起
  land: 'power2.out', // 落
  bounce: 'back.out(1.4)', // 弹
  smash: 'expo.in', // 砸的前半段
  settle: 'elastic.out(1, 0.45)', // 砸的后半段
  show: 'power2.out', // 飘：出现
  hide: 'power1.in', // 飘：消失
  pulse: 'sine.inOut', // 脉
  line: 'none', // 线
} as const;

// 分镜 1.8 的颜色，加上几张卡自己的主色
export const COLOR = {
  damage: 0xff3b30,
  heal: 0x3ddc84,
  buff: 0xffc44d,
  ice: 0x8fd8ff,
  fire: 0xff7a1a,
  light: 0xfff1b8,
  shadow: 0x6b3fa0,
  physical: 0xd9d9d9,
  wind: 0xd8fbff, // 狂风绝息斩的白青
  baron: 0x8a4dff, // 纳什男爵的紫
  white: 0xffffff,
} as const;

// ---------- 分量 ----------

// 同一回合里两张招牌卡连放时第二张降一档（m4-signature-fx 原则）。每张卡在它的主步里调一次，返回要降几档（0 或 1）
const turns = new WeakMap<TableScene, { turn: number; n: number }>();
export function claimTurn(scene: TableScene): number {
  const turn = scene.view.turn;
  const s = turns.get(scene);
  if (!s || s.turn !== turn) {
    turns.set(scene, { turn, n: 1 });
    return 0;
  }
  s.n++;
  return 1;
}

// 招牌卡的震屏不受 1.4 的频率限制（m4-signature-fx 原则），只按 claimTurn 降档
export function bigShake(scene: TableScene, level: ShakeLevel, down = 0): void {
  const l = Math.max(0, level - down) as ShakeLevel;
  if (l > 0) screenShake(scene, l, { force: true });
}

// 棋盘闪：招牌卡比群体法术亮一点，降档时暗一点
export function bigFlash(scene: TableScene, color: number, down = 0): void {
  boardFlash(scene, color, SCREEN.boardFlash * (down > 0 ? 0.75 : 1.1));
}

// 出错不往外抛：没有 AudioContext 的环境（自动化试玩的内置浏览器）里 Howler 设声像会抛错，
// 抛在 GSAP 的回调里会让同一个回调里后面的画面也跟着丢掉
export function sfx(id: SfxId, x?: number): void {
  try {
    playSfx(id, x === undefined ? {} : { pan: panAt(x) });
  } catch {
    // 声音丢一次不影响画面
  }
}

// ---------- 时间线 ----------

export function at(t: gsap.core.Timeline, time: number, fn: () => void): void {
  t.call(fn, undefined, time);
}

// 让时间线占住 [0, seconds]
export function span(t: gsap.core.Timeline, seconds: number): void {
  t.to({}, { duration: seconds }, 0);
}

// 把一个默认动画（受伤、死亡、冻结）放到 time 处：时间线并进来，它报的 cue 挪到同一时刻，交给 compose 在整步里挑一条。
// skip 里的频道不要（专属特效自己出了这一层，比如命中声"取一次重"）
export function place(t: gsap.core.Timeline, cues: Cue[], a: Anim, time: number, skip: readonly string[] = []): void {
  t.add(a.tl, time);
  for (const c of a.cues ?? []) if (!skip.includes(c.channel)) cues.push({ ...c, at: c.at + time });
}

// 临时物件：time 时挂到场景的 fx 层，until 时拿掉并释放它自己的材质和几何体（共用的 shared 不动、贴图不动）。
// 物件在播放时才建（make），没播到的不占显存
export function temp<T extends THREE.Object3D>(scene: TableScene, t: gsap.core.Timeline, time: number, until: number, make: () => T, onAdd?: (o: T) => void): { get: () => T | null } {
  let obj: T | null = null;
  at(t, time, () => {
    obj = make();
    scene.layers.fx.add(obj);
    onAdd?.(obj);
  });
  at(t, until, () => {
    if (obj) discard(obj);
    obj = null;
  });
  return { get: () => obj };
}

export function discard(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    gsap.killTweensOf(o);
    gsap.killTweensOf(o.position);
    gsap.killTweensOf(o.rotation);
    gsap.killTweensOf(o.scale);
    const m = o as THREE.Mesh;
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      gsap.killTweensOf(mat);
      if (!mat.userData.shared) mat.dispose();
    }
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
  });
  obj.removeFromParent();
}

// ---------- 坐标 ----------

export const ground = (p: Vec3, y = 0): Vec3 => ({ x: p.x, y, z: p.z });

export function minionRef(e: PresentationEvent): Extract<TargetRef, { kind: 'minion' }> | null {
  return 'target' in e && e.target && e.target.kind === 'minion' ? e.target : null;
}

export function minionOf(scene: TableScene, ref: TargetRef | null): MinionView | undefined {
  return ref && ref.kind === 'minion' ? scene.minion(ref.instanceId) : undefined;
}

// 一方随从行的中心线（台面上）
export function rowZ(scene: TableScene, side: Side): number {
  return boardRowZ(scene.place(side));
}

// 从 side 一方看，朝对面的方向（z 的符号）
export function towardEnemy(scene: TableScene, side: Side): number {
  return scene.place(side) === 'near' ? -1 : 1;
}

// 目标按画面横坐标从左到右排好，带上各自的位置（建时间线那一刻的位置）
export function byX<T extends PresentationEvent>(scene: TableScene, events: T[]): { e: T; k: number; p: Vec3 }[] {
  return events
    .map((e, k) => ({ e, k, p: 'target' in e && e.target ? scene.pointOf(e.target) : { x: 0, y: 0, z: 0 } }))
    .sort((a, b) => a.p.x - b.p.x);
}

// 底座 body 的抬起和落下（分镜的"抬 n 底座高"）。攻击动画正在驱动 body 时不动它
export function liftTo(body: THREE.Object3D, y: number, duration: number, ease: string): gsap.core.Tween {
  return gsap.to(body.position, { y, duration, ease, overwrite: 'auto' });
}

// 环境光压暗或恢复（半球光和太阳光一起乘 k）。记下原来的强度，调试台改过光照也能回到原值
const lightBase = new WeakMap<TableScene, { hemi: number; sun: number }>();
export function dimLights(scene: TableScene, k: number, duration: number, ease: string): void {
  const L = scene.lights;
  const b = lightBase.get(scene) ?? { hemi: L.hemi.intensity, sun: L.sun.intensity };
  lightBase.set(scene, b);
  gsap.killTweensOf([L.hemi, L.sun], 'intensity');
  gsap.to(L.hemi, { intensity: b.hemi * k, duration, ease });
  gsap.to(L.sun, {
    intensity: b.sun * k,
    duration,
    ease,
    onComplete: () => {
      if (k === 1) lightBase.delete(scene);
    },
  });
}

// 一条时间线所在的整步（最外层不是全局时间线的那一层）。泰达米尔的减速改的是它的 timeScale
export function stepOf(t: gsap.core.Animation): gsap.core.Animation {
  let p: gsap.core.Animation = t;
  while (p.parent && p.parent !== gsap.globalTimeline) p = p.parent;
  return p;
}

export const v3 = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
