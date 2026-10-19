// katarina.death_lotus 卡特琳娜 · 1000ms · 中（m4-signature-fx）。战吼的 damage 一组：
// 起手 0–150（起）：落地后底座下沉 0.05；
// 旋转 150–650（线）：底座绕 y 轴转两圈，slash_ring（slash_trail 的环形变体）48 道刀光向四周甩出，一圈血红的刀锋光环；
// 飞刀 650–800（线）：fire_bolt 的小号物理色变体同时射向每个敌方随从；
// 命中 从左到右错开 40ms：spark_light，接受伤；第一个 S1，命中声一次轻（受伤的 cue）；
// 收尾 800–1000（落）：转停。1 点群体伤害不比群体法术重，但转得够快才像她。
import gsap from 'gsap';
import type { EventOf } from '../../engine';
import { UNIT } from '../animations/combat';
import type { Cue } from '../animations/types';
import { SIGNATURE_PRESETS } from '../fx/particles/presets';
import { at, bigShake, byX, COLOR, EASE, place, sfx, span, temp } from './kit';
import { makeGroundRing } from './meshes';
import type { SignatureModule } from './registry';

export const DEATH_LOTUS = {
  sink: 0.15, // 起手
  spin: 0.5, // 旋转两圈
  turns: 2,
  knives: 0.15, // 飞刀
  fade: 0.2, // 收尾（转停）
  sinkBy: 0.05, // 下沉（底座高）
  stagger: 0.04,
};

type Dmg = EventOf<'damage'>;

export const deathLotus: SignatureModule = (c) => {
  const K = DEATH_LOTUS;
  const { scene } = c;
  const t = gsap.timeline();
  const cues: Cue[] = [];
  const dmg = c.events.filter((e): e is Dmg => e.kind === 'damage');
  if (dmg.length === 0) return { tl: t };
  const src = dmg[0]!.source;
  const kat = src.kind === 'minion' ? scene.minion(src.instanceId) : undefined;
  const home = kat ? { x: kat.position.x, y: 0, z: kat.position.z } : scene.pointOf({ side: src.side, kind: 'hero' });
  const list = byX(scene, dmg);
  const tSpin = K.sink;
  const tKnives = tSpin + K.spin;
  const tHit = tKnives + K.knives;
  const tEnd = tHit + K.fade;

  // 起手：下沉
  at(t, 0, () => {
    if (kat) gsap.to(kat.body.position, { y: -K.sinkBy * UNIT.base, duration: K.sink, ease: EASE.rise });
  });
  // 旋转：两圈匀速，转到飞刀出手后再减速停下（收尾）
  const spin = { a: 0 };
  const turn = Math.PI * 2 * K.turns;
  const setSpin = () => {
    if (kat) kat.body.rotation.y = spin.a;
  };
  t.to(spin, { a: turn, duration: K.spin, ease: EASE.line, onUpdate: setSpin }, tSpin);
  t.to(spin, { a: turn + Math.PI * 0.75, duration: K.knives + K.fade, ease: EASE.land, onUpdate: setSpin }, tKnives);
  at(t, tEnd, () => {
    if (!kat) return;
    kat.body.rotation.y = 0;
    gsap.to(kat.body.position, { y: 0, duration: 0.12, ease: EASE.land });
  });
  // 刀光和 whoosh：旋转期间持续甩出
  at(t, tSpin, () => scene.particles.emit(SIGNATURE_PRESETS.slash_ring, { at: home, count: 48, color: COLOR.physical }));
  for (let i = 0; i < 4; i++) at(t, tSpin - 0.05 + i * (K.spin / 4), () => sfx('combat.swing', home.x));
  // 贴地的刀锋光环：两圈，跟着转，转停时淡掉
  for (const [i, color, r] of [[0, 0xff3b30, 1.25], [1, 0xe8e8e8, 1.6]] as const) {
    const ring = temp(scene, t, tSpin, tEnd, () => makeGroundRing(color, i === 0 ? 2.4 : 1.8), (m) => {
      m.position.set(home.x, 0.04 + i * 0.01, home.z);
      m.scale.setScalar(0.4);
    });
    const st = { s: 0.4, o: 0 };
    const apply = () => {
      const m = ring.get();
      if (!m) return;
      m.scale.setScalar(st.s);
      m.material.opacity = st.o;
      m.rotation.z = spin.a * (i === 0 ? 1 : -1);
    };
    t.to(st, { s: r, o: 1, duration: 0.15, ease: EASE.land, onUpdate: apply }, tSpin);
    t.to(st, { s: r, duration: K.spin - 0.15, ease: 'none', onUpdate: apply }, tSpin + 0.15);
    t.to(st, { s: r * 1.3, o: 0, duration: K.knives + K.fade, ease: EASE.hide, onUpdate: apply }, tKnives);
  }

  // 飞刀：同时射向每个目标，到达时火花、受伤，从左到右错开
  list.forEach(({ e, k, p }, n) => {
    at(t, tKnives, () =>
      scene.particles.emit('fire_bolt', { at: { x: home.x, y: 0.45, z: home.z }, to: { x: p.x, y: 0.4, z: p.z }, count: 12, scale: 0.45, color: COLOR.physical, duration: K.knives }),
    );
    const hit = tHit + n * K.stagger;
    at(t, hit, () => {
      scene.particles.emit('spark_light', { at: { x: p.x, y: 0.4, z: p.z }, count: 10 });
      if (n === 0) bigShake(scene, 1);
    });
    place(t, cues, c.byDefault(k), hit);
  });

  span(t, tEnd);
  const lastHit = tHit + (list.length - 1) * K.stagger;
  return { tl: t, cues, tail: Math.max(0, t.duration() - lastHit), hitAt: tHit };
};
