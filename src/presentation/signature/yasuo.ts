// yasuo.last_breath 狂风绝息斩 · 1400ms · 重（m4-signature-fx）
// 起手（spell_cast）300：展示位白青风纹。主步（damage 一组）：
// 起风 0–300（线）：旋风从我方一侧卷过来，贴着敌方整排从左扫到右，路过的随从被风吹得抖；
// 抬起 300–450（起）：旋风回到这一排中间撑开，所有敌方随从被抬到 0.6 底座高，悬空抖动；
// 连斩 450–650（线）：三道横贯整排的刀光，slash_trail 每道 40；
// 砸回 650–900（砸）：从左到右每个错开 40ms 砸回台面，落地就是它的命中帧：伤害飘字、dust_land 8，第一下 S2、棋盘闪白；
// 收尾 900–1100（飘）：风散。记忆点是"抬起来再砸下去"，悬空 150ms 不省。
import gsap from 'gsap';
import type { EventOf } from '../../engine';
import { UNIT } from '../animations/combat';
import type { Cue } from '../animations/types';
import { SIGNATURE_PRESETS } from '../fx/particles/presets';
import { at, bigFlash, bigShake, byX, claimTurn, COLOR, EASE, minionOf, place, rowZ, sfx, span, temp } from './kit';
import { makeStreak, makeTornado } from './meshes';
import { prelude } from './prelude';
import type { SignatureModule } from './registry';

export const LAST_BREATH = {
  wind: 0.3, // 起风
  lift: 0.15, // 抬起
  slash: 0.2, // 连斩
  smash: 0.25, // 砸回
  smashIn: 0.11, // 砸回里加速落下的那一段，落地即命中帧
  fade: 0.2, // 收尾
  height: 0.6, // 抬起高度（底座高）
  slashes: 3,
  slashCount: 40,
  dust: 8,
  stagger: 0.04, // 砸回从左到右错开
};

type Dmg = EventOf<'damage'>;

export const lastBreath: SignatureModule = (c) => {
  if (c.events[0]!.kind === 'spell_cast') return prelude(c, { color: COLOR.wind, preset: 'slash_trail', count: 18, scale: 0.8, sounds: ['spell.physical'] });
  const L = LAST_BREATH;
  const { scene } = c;
  const t = gsap.timeline();
  const cues: Cue[] = [];
  const dmg = c.events.filter((e): e is Dmg => e.kind === 'damage');
  if (dmg.length === 0) return { tl: t };
  const down = claimTurn(scene);
  const foe = dmg[0]!.target.side;
  const me = dmg[0]!.source.side;
  const row = rowZ(scene, foe);
  const mine = rowZ(scene, me);
  const list = byX(scene, dmg);
  const xs = list.map((x) => x.p.x);
  const x0 = Math.min(...xs) - 1.2;
  const x1 = Math.max(...xs) + 1.2;
  const mid = (x0 + x1) / 2;
  const width = x1 - x0;
  const lifted = L.height * UNIT.base;
  const tLift = L.wind;
  const tSlash = tLift + L.lift;
  const tSmash = tSlash + L.slash;
  const tEnd = tSmash + L.smash + L.fade;

  // 声音：风声从起风起，持续到收尾；三声 whoosh 比刀光早 50ms
  at(t, 0, () => sfx('spell.big', x0));

  // 旋风：起风段沿路径扫过整排，抬起段回到中间撑开，砸回时散掉
  const path = { k: 0 };
  const tornadoPos = (k: number) => {
    // 前 30% 从我方一侧（河道附近的左边）斜插到敌方这一排的左端，其余沿这一排扫到右端
    if (k < 0.3) {
      const u = k / 0.3;
      return { x: x0 - 2.2 + 2.2 * u, z: mine + (row - mine) * (0.35 + 0.65 * u) };
    }
    const u = (k - 0.3) / 0.7;
    return { x: x0 + (x1 - x0) * u, z: row };
  };
  const tornado = temp(scene, t, 0, tEnd, () => makeTornado(COLOR.wind), (g) => {
    const p = tornadoPos(0);
    g.position.set(p.x, 0, p.z);
    g.scale.setScalar(0.9);
  });
  const windAt = () => {
    const g = tornado.get();
    return g ? { x: g.position.x, y: 0, z: g.position.z } : { x: mid, y: 0, z: row };
  };
  at(t, 0, () => scene.particles.emit(SIGNATURE_PRESETS.wind_spiral, { at: windAt(), follow: windAt }));
  t.to(path, {
    k: 1,
    duration: L.wind,
    ease: EASE.line,
    onUpdate: () => {
      const g = tornado.get();
      if (!g) return;
      const p = tornadoPos(path.k);
      g.position.set(p.x, 0, p.z);
    },
  }, 0);
  // 旋风自己的风痕每帧推进；不透明度：出现 → 撑开时减淡 → 散掉
  const tw = { o: 0, w: 0.9, h: 1 };
  let last = 0;
  t.to(tw, { o: 1, duration: 0.08, ease: EASE.show }, 0);
  t.to(tw, { w: width / 2.1, h: 0.75, o: 0.55, duration: L.lift, ease: EASE.land }, tLift);
  t.to(tw, { w: width / 1.6, h: 1.25, o: 0, duration: L.smash + L.fade * 0.5, ease: EASE.hide }, tSmash);
  t.to({}, {
    duration: tEnd,
    ease: 'none',
    onUpdate() {
      const g = tornado.get();
      if (!g) return;
      const now = this.time();
      g.tick(Math.max(0, now - last));
      last = now;
      g.opacity = tw.o;
      g.scale.set(tw.w, tw.h, Math.min(tw.w, 1.6));
    },
  }, 0);
  at(t, tLift, () => {
    const g = tornado.get();
    if (g) gsap.to(g.position, { x: mid, z: row, duration: L.lift, ease: EASE.land });
  });

  list.forEach(({ e, k, p }, n) => {
    const m = () => minionOf(scene, e.target);
    // 旋风路过时被吹得抖一下
    const pass = L.wind * (0.3 + 0.7 * Math.max(0, Math.min(1, (p.x - x0) / (x1 - x0))));
    at(t, pass, () => {
      const v = m();
      if (v) gsap.fromTo(v.body.rotation, { z: 0.08 }, { z: 0, duration: 0.2, ease: 'elastic.out(1, 0.35)' });
    });
    // 抬起（起）、悬空抖动
    at(t, tLift + n * 0.015, () => {
      const v = m();
      if (!v) return;
      gsap.to(v.body.position, { y: lifted, duration: L.lift, ease: EASE.rise, overwrite: 'auto' });
      gsap.to(v.body.rotation, { x: 0.12 * (n % 2 ? 1 : -1), z: 0.1 * (n % 2 ? -1 : 1), duration: L.lift, ease: EASE.rise });
      scene.particles.emit(SIGNATURE_PRESETS.wind_spiral, { at: { x: p.x, y: 0, z: p.z }, count: 10, scale: 0.6 });
    });
    const shakeTl = gsap.timeline();
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      shakeTl.call(() => {
        const v = m();
        if (v) v.body.position.set(Math.cos(a) * 0.05, lifted + Math.sin(a * 3) * 0.04, Math.sin(a) * 0.035);
      }, undefined, i * 0.025);
    }
    t.add(shakeTl, tSlash);
    // 砸回：expo.in 落到台面，落地就是命中帧，压扁再弹回
    const hit = tSmash + n * L.stagger + L.smashIn;
    at(t, tSmash + n * L.stagger, () => {
      const v = m();
      if (!v) return;
      gsap.to(v.body.position, { x: 0, y: 0, z: 0, duration: L.smashIn, ease: EASE.smash, overwrite: 'auto' });
      gsap.to(v.body.rotation, { x: 0, z: 0, duration: L.smashIn, ease: EASE.smash });
    });
    at(t, hit, () => {
      const v = m();
      if (v) gsap.fromTo(v.body.scale, { x: 1.1, y: 0.8, z: 1.1 }, { x: 1, y: 1, z: 1, duration: L.smash - L.smashIn + L.fade * 0.5, ease: EASE.settle });
      scene.particles.emit('dust_land', { at: { x: p.x, y: 0, z: p.z }, count: L.dust });
      if (n === 0) {
        bigShake(scene, 2, down);
        bigFlash(scene, COLOR.white, down);
        sfx('combat.hero_hit', p.x); // 落地的那一下低频，命中声由受伤的 cue 出（取一次重）
      }
    });
    place(t, cues, c.byDefault(k), hit);
  });

  // 连斩：三道横贯整排的刀光，交替高低、略斜，各带一串 slash_trail
  for (let i = 0; i < L.slashes; i++) {
    const s = tSlash + 0.02 + i * (L.slash - 0.06) / L.slashes;
    const y = lifted + 0.35 + (i - 1) * 0.22;
    const tilt = (i % 2 ? -1 : 1) * 0.1;
    const dz = (i - 1) * 0.25;
    at(t, s - 0.05, () => sfx('combat.swing', mid));
    const streak = temp(scene, t, s, s + 0.16, () => makeStreak(width + 1.5, 0.42, COLOR.wind, 3.2), (m) => {
      m.position.set(mid, y, row + dz);
      m.rotation.z = tilt;
      m.scale.x = 0.01;
    });
    t.to({ k: 0 }, {
      k: 1,
      duration: 0.16,
      ease: 'none',
      onUpdate() {
        const m = streak.get();
        if (!m) return;
        const k = (this.targets()[0] as { k: number }).k;
        m.scale.x = (width + 1.5) * Math.min(1, k / 0.35);
        m.position.x = mid - ((width + 1.5) / 2) * (1 - Math.min(1, k / 0.35));
        m.material.opacity = 1 - Math.max(0, (k - 0.35) / 0.65);
      },
    }, s);
    at(t, s, () => {
      const from = { x: x0 - 0.4, y, z: row + dz + 0.1 };
      const to = { x: x1 + 0.4, y: y + tilt * width * 0.5, z: row + dz + 0.1 };
      scene.particles.emit('slash_trail', { at: from, to, count: L.slashCount, color: COLOR.wind, duration: 0.09 });
      for (const { p } of list) scene.particles.emit('spark_light', { at: { x: p.x, y: lifted + 0.3, z: p.z }, count: 4 });
    });
  }

  // 收尾：风散，最后一缕风从整排上卷起
  at(t, tSmash + L.smashIn + 0.05, () => scene.particles.emit(SIGNATURE_PRESETS.wind_spiral, { at: { x: mid, y: 0, z: row }, count: 22, scale: 1.4 }));
  span(t, tEnd);
  // 最后一个落地之后都算收尾
  const firstHit = tSmash + L.smashIn;
  const lastHit = firstHit + (list.length - 1) * L.stagger;
  return { tl: t, cues, tail: Math.max(0, t.duration() - lastHit), hitAt: firstHit };
};
