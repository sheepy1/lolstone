// tryndamere.undying_rage 泰达米尔 · 900ms · 中（m4-signature-fx）。脚本触发（trigger，timing script），
// 和那次致命伤害在同一步：攻击那一步里从撞击时刻开始，E12 的飘字（含"免死"）照出。
// 减速 0–200（无）：整步 timeScale 降到 0.3，泰达米尔头像红色自发光到 1，底座抬 0.3 底座高（弹）；
// 怒吼 200–500（脉）：两圈伤害红的 buff_ring 从他向外扩，徽章数字闪红 3 次（数字已经是 1）；
// 恢复 500–900（落）：timeScale 回到 1，红光淡出，留一层淡红常驻到回合结束。
// 记忆点是时间慢下来那一瞬：减速代替震屏，只在怒吼时补一个 S1。
// 这一段画面放在一条挂在全局时间线上的独立时间线里，不受整步减速影响，按真实时间播；整步里只占一个位置。
import gsap from 'gsap';
import { HIT, portraitMesh, UNIT } from '../animations/combat';
import { TINT } from '../animations/util';
import { at, bigShake, COLOR, EASE, sfx, span, stepOf } from './kit';
import { makeGroundRing } from './meshes';
import type { SignatureModule } from './registry';

export const UNDYING_RAGE = {
  slow: 0.2, // 减速
  roar: 0.3, // 怒吼
  recover: 0.4, // 恢复
  timeScale: 0.3,
  lift: 0.3, // 抬起（底座高）
  glow: 1, // 头像红色自发光
  linger: 0.22, // 常驻的淡红
};

export const undyingRage: SignatureModule = (c) => {
  const U = UNDYING_RAGE;
  const { scene } = c;
  const t = gsap.timeline();
  const e = c.events[0]!;
  if (e.kind !== 'trigger' || e.source.kind !== 'minion') return { tl: t };
  const id = e.source.instanceId;
  const turn = scene.view.turn;
  // 整步在减速里走过的"步内时间"：减速 + 怒吼按 0.3 倍，恢复段平均约 0.65 倍
  const inStep = (U.slow + U.roar) * U.timeScale + U.recover * 0.65;

  at(t, 0, () => {
    const m = scene.minion(id);
    const step = stepOf(t);
    const x = m ? m.position.x : 0;
    const real = gsap.timeline();
    // 时间：整步减速，再回到 1（控制补间挂在全局时间线上，自己不被减速）
    if (step !== t) {
      real.to(step, { timeScale: U.timeScale, duration: 0.03, ease: 'none' }, 0);
      real.to(step, { timeScale: 1, duration: U.recover, ease: EASE.land }, U.slow + U.roar);
    }
    // impact 低频一次。同一步（攻击）的命中声 cue 取最重的那条：有 ≥ 5 的伤害或打到英雄时，它已经带了一层 combat.hero_hit，
    // 而且和这里同一刻（撞击帧），再放就是同一个音效响两次
    const lowAlready = c.step.some((x) => x.kind === 'damage' && x.amount > 0 && (x.target.kind === 'hero' || x.amount >= HIT.lowAt));
    real.call(() => {
      sfx('spell.fire', x);
      if (!lowAlready) sfx('combat.hero_hit', x);
    }, undefined, 0);
    if (!m) return;
    const mat = portraitMesh(m)?.material;
    if (mat && 'emissive' in mat) {
      gsap.killTweensOf(mat, 'emissiveIntensity');
      mat.emissive.setHex(COLOR.damage);
      real.to(mat, { emissiveIntensity: U.glow, duration: U.slow, ease: EASE.land }, 0);
      real.to(mat, { emissiveIntensity: U.linger, duration: U.recover, ease: EASE.land }, U.slow + U.roar);
      // 淡红常驻到回合结束（换回合或他离场时退掉）
      const stop = scene.stage.onFrame(() => {
        if (scene.minion(id) === m && scene.view.turn === turn) return;
        stop();
        gsap.to(mat, { emissiveIntensity: 0, duration: 0.3 });
      });
    }
    // 底座抬起（弹）再落回。动外层 Group：攻击动画可能还在驱动 body
    real.to(m.position, { y: U.lift * UNIT.base, duration: U.slow, ease: EASE.bounce }, 0);
    real.to(m.position, { y: 0, duration: U.recover, ease: EASE.land }, U.slow + U.roar);
    // 怒吼：两圈红环、地面一圈红光、徽章闪红三次
    real.call(() => {
      const p = scene.pointOf({ side: m.side, kind: 'minion', instanceId: id });
      scene.particles.emit('buff_ring', { at: { x: p.x, y: 0, z: p.z }, color: COLOR.damage, count: 40, scale: 1.4 });
      scene.particles.emit('spark_heavy', { at: { x: p.x, y: 0.5, z: p.z }, color: COLOR.fire, count: 10 });
      bigShake(scene, 1);
      const ring = makeGroundRing(COLOR.damage, 2.6);
      ring.position.set(p.x, 0.04, p.z);
      ring.scale.setScalar(0.6);
      scene.layers.fx.add(ring);
      gsap.to(ring.scale, { x: 3.2, y: 3.2, z: 3.2, duration: U.roar + 0.15, ease: EASE.land });
      gsap.to(ring.material, {
        opacity: 0,
        duration: U.roar + 0.15,
        ease: EASE.hide,
        onComplete: () => {
          ring.removeFromParent();
          ring.material.dispose();
        },
      });
    }, undefined, U.slow);
    real.call(() => {
      const p = scene.pointOf({ side: m.side, kind: 'minion', instanceId: id });
      scene.particles.emit('buff_ring', { at: { x: p.x, y: 0, z: p.z }, color: COLOR.damage, count: 40, scale: 2.1 });
    }, undefined, U.slow + 0.12);
    for (let i = 0; i < 3; i++) real.call(() => scene.minion(id)?.badges.health.pop(TINT.damage), undefined, U.slow + i * (U.roar / 3));
  });
  span(t, inStep);
  return { tl: t, tail: U.recover * 0.65 };
};
