// baron.hand_of_baron 纳什男爵 · 1000ms · 中（m4-signature-fx）。回合结束触发的 buff 一组：
// 脉冲 0–400（线）：男爵底座一圈紫色（#8a4dff）光环向外扩，扩到最远的友方随从外面；
// 增益 每个 400、错开 40（E15）：光环扩到哪个友方随从，它就走 E15（徽章弹、数字变绿），头像蒙一层紫光，脚下一圈紫色 buff_ring；
// 收尾 200（飘）。没有震屏，低沉的嗡鸣一次，增益声只播一次。每回合都会触发，不能重，靠颜色辨识。
import gsap from 'gsap';
import type { EventOf } from '../../engine';
import { portraitGlow } from '../animations/combat';
import { TINT } from '../animations/util';
import { at, COLOR, EASE, sfx, span, temp } from './kit';
import { makeGroundRing } from './meshes';
import type { SignatureModule } from './registry';

export const HAND_OF_BARON = {
  pulse: 0.4, // 脉冲
  buff: 0.4, // 每个随从的增益
  stagger: 0.04,
  fade: 0.2,
};

type Buff = EventOf<'buff'>;

export const handOfBaron: SignatureModule = (c) => {
  const B = HAND_OF_BARON;
  const { scene } = c;
  const t = gsap.timeline();
  const buffs = c.events.filter((e): e is Buff => e.kind === 'buff');
  if (buffs.length === 0) return { tl: t };
  const src = buffs[0]!.source;
  const baron = src && src.kind === 'minion' ? scene.minion(src.instanceId) : undefined;
  const o = baron ? { x: baron.position.x, z: baron.position.z } : { x: 0, z: scene.pointOf(buffs[0]!.target).z };
  const targets = buffs.map((e, k) => ({ e, k, p: scene.pointOf(e.target) }));
  const dist = (p: { x: number; z: number }) => Math.hypot(p.x - o.x, p.z - o.z);
  const reach = Math.max(1.5, ...targets.map((x) => dist(x.p))) + 0.6;
  // 光环扩到每个随从的时刻，按到达先后至少错开 40ms
  const sorted = [...targets].sort((a, b) => dist(a.p) - dist(b.p));
  const arrive = new Map<number, number>();
  let prev = -Infinity;
  for (const x of sorted) {
    const tt = Math.max(B.pulse * (dist(x.p) / reach), prev + B.stagger);
    arrive.set(x.k, tt);
    prev = tt;
  }
  const lastBuff = prev;
  const tEnd = Math.max(B.pulse, lastBuff + B.buff) + B.fade;

  at(t, 0, () => {
    sfx('spell.shadow', o.x);
    if (baron) portraitGlow(baron, COLOR.baron, 1, B.pulse + 0.2);
    scene.particles.emit('buff_ring', { at: { x: o.x, y: 0, z: o.z }, color: COLOR.baron, scale: 1.2, count: 26 });
  });
  // 两圈紫环：亮的在前，淡的跟在后面
  for (const [lag, intensity] of [[0, 2.6], [0.08, 1.4]] as const) {
    const ring = temp(scene, t, lag, B.pulse + lag + 0.25, () => makeGroundRing(COLOR.baron, intensity), (m) => {
      m.position.set(o.x, 0.04, o.z);
      m.scale.setScalar(0.8);
    });
    const st = { r: 0.8, a: 1 };
    const apply = () => {
      const m = ring.get();
      if (!m) return;
      m.scale.setScalar(st.r);
      m.material.opacity = st.a;
    };
    t.to(st, { r: reach, duration: B.pulse, ease: EASE.line, onUpdate: apply }, lag);
    t.to(st, { a: 0, duration: 0.25, ease: EASE.hide, onUpdate: apply }, B.pulse + lag);
  }
  // 每个友方随从：E15，头像蒙紫光
  let first = true;
  for (const { e, k, p } of targets) {
    const tt = arrive.get(k)!;
    const once = first;
    first = false;
    at(t, tt, () => {
      if (once) sfx('card.buff', p.x);
      // 数字先临时跳到增益后的值（显示局面按事件顺序累积，光环到达的先后和事件顺序不一样），整组最后同步一次
      const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
      m?.showHealth(e.healthAfter); // MinionView 只能临时改一个数，攻击在整组同步时跟上
      scene.particles.emit('buff_ring', { at: { x: p.x, y: 0, z: p.z }, color: COLOR.baron });
      if (!m) return;
      portraitGlow(m, COLOR.baron, 0.9, B.buff);
      if (e.attack !== 0) m.badges.attack.pop(e.attack > 0 ? TINT.buff : TINT.debuff);
      if (e.health !== 0) m.badges.health.pop(e.health > 0 ? TINT.buff : TINT.debuff);
    });
  }
  at(t, lastBuff + 0.05, () => scene.sync(c.ctxs[c.ctxs.length - 1]!.after, 0.05));
  span(t, tEnd);
  return { tl: t, tail: tEnd - lastBuff };
};
