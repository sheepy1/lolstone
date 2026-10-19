// leesin.dragons_rage 李青 · 900ms · 中（m4-signature-fx）。连击回手（bounce）那一步：
// 蓄力 0–150（起）：E11 的蓄力（后仰、后退、抬起）；
// 冲踢 150–330（起）：E11 的冲锋，冲到目标跟前，slash_trail 跟着；
// 命中帧 330：spark_heavy，S1，命中声一次重；
// 踢飞 330–630（起）：目标沿一条很高的弧线飞回它拥有者的手牌，边飞边翻，带 slash_trail；落进手牌时弹一下、落位声；
// 回位 360–630（落）：李青弹回原槽。弧线要高，让玩家看清是"踢回手里"。手牌满被销毁时，飞到弧顶炸开消散。
import gsap from 'gsap';
import * as THREE from 'three';
import type { EventOf } from '../../engine';
import { ATTACK, UNIT } from '../animations/combat';
import { handSlot } from '../layout';
import { at, bigShake, COLOR, EASE, sfx, span, towardEnemy } from './kit';
import type { SignatureModule } from './registry';

export const DRAGONS_RAGE = {
  windup: 0.15, // 蓄力
  dash: 0.18, // 冲踢
  kick: 0.3, // 踢飞
  back: 0.27, // 回位
  apex: 3.4, // 弧顶高度（世界单位，高过双方枢纽，又不出画面上边）
  stopShort: 0.45, // 停在目标前多远（槽距）
  spin: 2.5, // 踢飞时翻几圈
};

type Bounce = EventOf<'bounce'>;

export const dragonsRage: SignatureModule = (c) => {
  const D = DRAGONS_RAGE;
  const { scene } = c;
  const t = gsap.timeline();
  const e = c.events.find((x): x is Bounce => x.kind === 'bounce');
  if (!e || e.target.kind !== 'minion') return { tl: t };
  const after = c.ctxs[c.events.indexOf(e)]!.after;
  const leeId = e.source.kind === 'minion' ? e.source.instanceId : null;
  const victimId = e.target.instanceId;
  const owner = e.target.side;
  const tDash = D.windup;
  const tHit = tDash + D.dash;
  const tLand = tHit + D.kick;
  const tEnd = Math.max(tLand, tHit + 0.03 + D.back);

  // 蓄力、冲踢：动 body（外层 Group 归布局），冲到目标跟前
  at(t, 0, () => {
    const lee = leeId !== null ? scene.minion(leeId) : undefined;
    if (!lee) return;
    const dz = towardEnemy(scene, e.source.side);
    lee.body.userData.driven = true;
    gsap.to(lee.body.rotation, { x: -dz * THREE.MathUtils.degToRad(ATTACK.windupTilt), duration: D.windup, ease: EASE.rise });
    gsap.to(lee.body.position, { z: -dz * ATTACK.windupBack * UNIT.slot, y: ATTACK.windupLift * UNIT.base, duration: D.windup, ease: EASE.rise });
  });
  at(t, tDash - 0.05, () => sfx('combat.swing'));
  at(t, tDash, () => {
    const lee = leeId !== null ? scene.minion(leeId) : undefined;
    const v = scene.minion(victimId);
    if (!lee || !v) return;
    const dx = v.position.x - lee.position.x;
    const dz = v.position.z - lee.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const stop = Math.max(0, len - D.stopShort * UNIT.slot);
    gsap.to(lee.body.position, { x: (dx / len) * stop, z: (dz / len) * stop, duration: D.dash, ease: EASE.rise });
    gsap.to(lee.body.position, { y: 0.35, duration: D.dash * 0.6, ease: EASE.land, yoyo: true, repeat: 1 });
    gsap.to(lee.body.rotation, { x: towardEnemy(scene, e.source.side) * 0.18, duration: D.dash, ease: EASE.rise });
    const follow = () => ({ x: lee.position.x + lee.body.position.x, y: 0.35 + lee.body.position.y, z: lee.position.z + lee.body.position.z });
    scene.particles.emit('slash_trail', { at: follow(), follow, count: 16, color: 0xffd28a });
  });

  // 命中帧
  at(t, tHit, () => {
    const v = scene.minion(victimId);
    const p = scene.pointOf(e.target);
    scene.particles.emit('spark_heavy', { at: { x: p.x, y: 0.45, z: p.z }, count: 18 });
    scene.particles.emit('spark_heavy', { at: { x: p.x, y: 0.45, z: p.z }, count: 6, color: 0xffb040 });
    bigShake(scene, 1);
    sfx('combat.hit_heavy', p.x);
    if (v) {
      v.flash.material.color.setHex(0xffffff);
      gsap.fromTo(v.flash.material, { opacity: 0.9 }, { opacity: 0, duration: 0.2 });
    }
  });

  // 踢飞：高弧线飞向拥有者的手牌，边飞边翻、缩小
  at(t, tHit, () => {
    const v = scene.minion(victimId);
    if (!v) return;
    sfx('card.bounce', v.position.x);
    const handCount = after.players[owner].hand.length;
    const end = e.handIndex !== null && !e.destroyed ? handSlot(scene.place(owner), e.handIndex, Math.max(1, handCount)).pos : null;
    const start = new THREE.Vector3(v.position.x + v.body.position.x, v.body.position.y, v.position.z + v.body.position.z);
    const target = end ? new THREE.Vector3(end.x, end.y, end.z) : start.clone().add(new THREE.Vector3(0, D.apex, 0));
    const ctrl = start.clone().lerp(target, 0.4);
    ctrl.y = D.apex * 2 - (start.y + target.y) / 2; // 二次贝塞尔的顶点高度约是控制点和两端平均的一半
    const curve = new THREE.QuadraticBezierCurve3(start, ctrl, target);
    v.body.userData.driven = true;
    const st = { k: 0 };
    const local = new THREE.Vector3();
    gsap.to(st, {
      k: 1,
      duration: D.kick,
      ease: 'power2.out',
      onUpdate: () => {
        curve.getPoint(st.k, local);
        v.body.position.set(local.x - v.position.x, local.y - v.position.y, local.z - v.position.z);
        v.body.rotation.z = st.k * Math.PI * 2 * D.spin * (owner === 0 ? 1 : -1);
        v.body.rotation.x = st.k * 0.8;
        const s = 1 - 0.5 * st.k;
        v.body.scale.set(s, s, s);
      },
    });
    const follow = () => ({ x: v.position.x + v.body.position.x, y: v.position.y + v.body.position.y + 0.2, z: v.position.z + v.body.position.z });
    scene.particles.emit('slash_trail', { at: follow(), follow, count: 40, color: COLOR.white, duration: D.kick });
  });

  // 落进手牌：手牌从踢飞的落点长出来，布局把它并进扇形（弹）；手牌满时在弧顶炸开
  at(t, tLand, () => {
    const v = scene.minion(victimId);
    const p = v ? { x: v.position.x + v.body.position.x, y: v.body.position.y, z: v.position.z + v.body.position.z } : scene.pointOf(e.target);
    if (e.card && !e.destroyed) {
      scene.handSpawn.set(e.card.instanceId, p);
      sfx('ui.drop', p.x);
    } else {
      scene.particles.emit('death_shards', { at: p, count: 16, color: 0x9a9aa8 });
      scene.particles.emit('spark_light', { at: p, count: 10 });
    }
    if (v) v.body.visible = false;
    scene.sync(after, 0.22);
  });

  // 回位：李青弹回原槽
  at(t, tHit + 0.03, () => {
    const lee = leeId !== null ? scene.minion(leeId) : undefined;
    if (!lee) return;
    gsap.to(lee.body.position, { x: 0, y: 0, z: 0, duration: D.back, ease: EASE.land, overwrite: 'auto', onComplete: () => (lee.body.userData.driven = false) });
    gsap.to(lee.body.rotation, { x: 0, duration: D.back, ease: EASE.land });
    scene.particles.emit('dust_land', { at: { x: lee.position.x, y: 0, z: lee.position.z }, count: 4 });
  });
  span(t, tEnd);
  return { tl: t, tail: tEnd - tHit, hitAt: tHit };
};
