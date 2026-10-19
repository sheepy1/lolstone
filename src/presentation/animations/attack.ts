// 攻击（m4-storyboard E11，600ms，中档）：
// 蓄力 150ms（起）：底座后仰 12°、后退 0.15 槽距、抬 0.1 底座高；
// 冲锋 180ms（起）：抬到 0.6 底座高，沿弧线扑向目标（弧顶在 60% 处），前倾，slash_trail 跟着；
// 命中帧 t=330ms：停在目标前 0.3 槽距，撞击火花按伤害分轻重，同一步的受伤事件从这一帧开始（impact）；
// 回位 270ms（落）：弹回原槽，落地 dust_land。挥击声比冲锋早 50ms，命中声由受伤事件报（整步只播最重的一次）。
// 伤害 ≥ 4 时 S1；目标是英雄时由英雄受伤（E24）决定。风怒的第二次攻击蓄力缩到 80ms。
import gsap from 'gsap';
import * as THREE from 'three';
import type { Side } from '../../engine';
import type { TableScene } from '../../scene/table';
import { ATTACK, HIT, hold, sfxAt, shakeCue, UNIT } from './combat';
import type { AnimModule, Cue } from './types';
import { tl } from './util';

const DEG = Math.PI / 180;

// 每个随从这一回合攻击了几次（风怒第二次攻击用短蓄力）
const attacksThisTurn = new WeakMap<TableScene, Map<number, { turn: number; n: number }>>();
function countAttack(scene: TableScene, id: number): number {
  let m = attacksThisTurn.get(scene);
  if (!m) attacksThisTurn.set(scene, (m = new Map()));
  const turn = scene.view.turn;
  const cur = m.get(id);
  const n = cur && cur.turn === turn ? cur.n + 1 : 1;
  m.set(id, { turn, n });
  return n;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const attack: AnimModule<'attack'> = (e, { scene, before }) => {
  const A = ATTACK;
  const t = tl();
  const attacker = e.attacker.kind === 'minion' ? scene.minion(e.attacker.instanceId) : undefined;
  if (!attacker) {
    hold(t, 0.2);
    return { tl: t, impact: 0.2 };
  }
  const id = attacker.instanceId;
  const side: Side = e.attacker.side;
  const amount = before.players[side].board.find((m) => m.instanceId === id)?.attack ?? 0;
  const windup = countAttack(scene, id) >= 2 ? A.windfuryWindup : A.windup;
  const body = attacker.body;
  const impact = windup + A.dash;

  // 起止位置在播放时才算（目标可能刚挪过位置）
  const d = new THREE.Vector3(0, 0, -1); // 冲锋方向（台面上的单位向量）
  const axis = new THREE.Vector3(1, 0, 0); // 后仰的转轴
  const hit = new THREE.Vector3(); // 撞上时 body 的位置（相对槽位）
  const pose = { x: 0, y: 0, z: 0, tilt: 0, sy: 1, sx: 1 };
  const q = new THREE.Quaternion();
  const apply = () => {
    const j = (body.userData.jitter ?? { x: 0, z: 0 }) as { x: number; z: number };
    body.position.set(pose.x + j.x, pose.y, pose.z + j.z);
    body.quaternion.copy(q.setFromAxisAngle(axis, pose.tilt * DEG));
    body.scale.set(pose.sx, pose.sy, pose.sx);
  };
  t.call(() => {
    const from = attacker.position;
    const to = scene.pointOf(e.target);
    d.set(to.x - from.x, 0, to.z - from.z);
    const len = d.length() || 1;
    d.divideScalar(len);
    axis.set(-d.z, 0, d.x);
    const reach = Math.max(0, len - A.stopShort * UNIT.slot);
    hit.set(d.x * reach, A.hitY, d.z * reach);
    body.userData.driven = true;
    Object.assign(pose, { x: 0, y: 0, z: 0, tilt: 0, sx: 1, sy: 1 });
  });

  // 蓄力
  const w = { u: 0 };
  t.to(w, {
    u: 1,
    duration: windup,
    ease: 'power3.in',
    onUpdate: () => {
      const back = A.windupBack * UNIT.slot * w.u;
      Object.assign(pose, { x: -d.x * back, y: A.windupLift * UNIT.base * w.u, z: -d.z * back, tilt: A.windupTilt * w.u });
      apply();
    },
  });
  t.call(() => sfxAt('combat.swing', attacker.position.x), undefined, Math.max(0, windup - A.swingLead));

  // 冲锋：水平按"起"加速，高度走一条弧顶在 arcPeak 处的弧线
  const dash = { k: 0 };
  const startBack = () => A.windupBack * UNIT.slot;
  const y0 = A.windupLift * UNIT.base;
  const peak = A.dashLift * UNIT.base;
  t.call(() => {
    scene.particles.emit('slash_trail', {
      at: scene.pointOf(e.attacker),
      follow: () => {
        const p = scene.pointOf(e.attacker);
        return { x: p.x, y: p.y + 0.1, z: p.z };
      },
      count: A.trail,
      to: scene.pointOf(e.target),
    });
  });
  t.to(dash, {
    k: 1,
    duration: A.dash,
    ease: 'power3.in',
    onUpdate: () => {
      const k = dash.k;
      const sx = -d.x * startBack();
      const sz = -d.z * startBack();
      const y = k < A.arcPeak ? lerp(y0, peak, Math.sin((k / A.arcPeak) * (Math.PI / 2))) : lerp(peak, A.hitY, 1 - Math.cos(((k - A.arcPeak) / (1 - A.arcPeak)) * (Math.PI / 2)));
      Object.assign(pose, { x: lerp(sx, hit.x, k), y, z: lerp(sz, hit.z, k), tilt: lerp(A.windupTilt, A.dashTilt, Math.min(1, k * 1.6)) });
      apply();
    },
  });

  // 命中帧：撞击火花（按伤害分轻重）、攻击方被反冲压扁一下
  t.call(() => {
    const p = scene.pointOf(e.attacker);
    const at = { x: p.x + d.x * 0.55, y: 0.38, z: p.z + d.z * 0.55 };
    if (amount >= HIT.heavyAt) scene.particles.emit('spark_heavy', { at, count: HIT.sparkHeavy, to: { x: at.x + d.x, y: at.y, z: at.z + d.z } });
    else scene.particles.emit('spark_light', { at, count: HIT.sparkLight, to: { x: at.x + d.x, y: at.y, z: at.z + d.z } });
  });
  // 回位：反冲后弹回原槽，轻轻落地
  const back = { r: 0 };
  t.to(back, {
    r: 1,
    duration: A.recover,
    ease: 'power2.out',
    onUpdate: () => {
      const r = back.r;
      const squash = Math.max(0, 1 - r * 4); // 撞上后前 1/4 段压扁回正
      Object.assign(pose, {
        x: lerp(hit.x, 0, r),
        y: lerp(A.hitY, 0, r) + Math.sin(r * Math.PI) * 0.25,
        z: lerp(hit.z, 0, r),
        tilt: lerp(A.dashTilt, 0, r),
        sy: 1 - 0.1 * squash,
        sx: 1 + 0.06 * squash,
      });
      apply();
    },
  });
  t.call(() => {
    body.userData.driven = false;
    body.position.set(0, 0, 0);
    body.quaternion.identity();
    body.scale.set(1, 1, 1);
    const p = attacker.position;
    scene.particles.emit('dust_land', { at: { x: p.x, y: 0, z: p.z }, count: A.landDust });
  });

  const cues: Cue[] = [];
  if (e.target.kind === 'minion' && amount >= A.shakeAt) cues.push(shakeCue(scene, impact, 1));
  return { tl: t, impact, cues };
};
