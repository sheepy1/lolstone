// anivia.glacial_storm 暴风雪 · 1300ms · 重（m4-signature-fx）
// 起手（spell_cast）300：展示位冰霜蓄势。主步（damage 一组）：
// 压暗 0–200（落）：环境光 -20%，敌方半场上空起冰雾，地面结一层薄霜；
// 风雪 200–800（线）：blizzard_fall（frost_spread 的变体，dir down）覆盖敌方半场持续落下；雪落到每个目标的那一刻是它的命中帧，
//   从左到右错开 60ms：伤害飘字 + E17 覆冰；第一个命中帧 S2、棋盘闪冰色，冰击声取一次重；
// 收尾 800–1000（落）：环境光恢复，雪停，地面霜退。
// 冻结那一组（freeze 事件也带这个 fxId）：冰已经在命中帧覆上了，这里只把显示局面对上，不再播一遍 E17。
// 和通用群体法术的区别是"持续落下"而不是一下子炸开。
import gsap from 'gsap';
import type { EventOf } from '../../engine';
import { FREEZE, jitter, UNIT } from '../animations/combat';
import type { Cue } from '../animations/types';
import { SIGNATURE_PRESETS } from '../fx/particles/presets';
import { frostRing } from '../fx/iceShell';
import { at, bigFlash, bigShake, byX, claimTurn, COLOR, dimLights, EASE, minionOf, place, rowZ, sfx, span, temp } from './kit';
import { makeFrostSheet } from './meshes';
import { prelude } from './prelude';
import type { SignatureModule } from './registry';

export const GLACIAL_STORM = {
  dim: 0.2, // 压暗
  storm: 0.6, // 风雪
  fade: 0.2, // 收尾
  light: 0.8, // 压暗到原来的多少
  firstHit: 0.1, // 风雪开始后多久雪落到第一个目标
  stagger: 0.06, // 从左到右错开
  snow: 80,
  height: 3.2, // 雪从多高落下
};

type Dmg = EventOf<'damage'>;

export const glacialStorm: SignatureModule = (c) => {
  const first = c.events[0]!;
  if (first.kind === 'spell_cast') return prelude(c, { fx: 'frost', color: COLOR.ice, preset: 'frost_spread', count: 20, scale: 0.8, sounds: ['spell.frost'] });
  const { scene } = c;
  const t = gsap.timeline();
  if (first.kind === 'freeze') {
    // 冰在伤害那一步的命中帧已经覆上，这里只同步显示局面（冻结的徽章、冰层常驻）
    const last = c.ctxs[c.ctxs.length - 1]!.after;
    at(t, 0, () => {
      scene.sync(last, 0.1);
      // 伤害那一步没覆上冰的（比如那一步被跳过），这里补长一次
      for (const e of c.events) {
        const m = minionOf(scene, 'target' in e ? e.target : null);
        if (m && !m.ice.visible) m.ice.grow(0.2);
      }
    });
    span(t, 0.05);
    return { tl: t, tail: 0.05 };
  }
  const G = GLACIAL_STORM;
  const cues: Cue[] = [];
  const dmg = c.events.filter((e): e is Dmg => e.kind === 'damage');
  if (dmg.length === 0) return { tl: t };
  const down = claimTurn(scene);
  const foe = dmg[0]!.target.side;
  const row = rowZ(scene, foe);
  const list = byX(scene, dmg);
  const xs = list.map((x) => x.p.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const tStorm = G.dim;
  const tFade = tStorm + G.storm;
  const tEnd = tFade + G.fade;

  // 压暗、冰雾、薄霜
  at(t, 0, () => {
    dimLights(scene, G.light, G.dim, EASE.land);
    sfx('spell.big', mid);
    sfx('spell.frost', mid);
  });
  const sheet = temp(scene, t, 0, tEnd + 0.3, () => makeFrostSheet(16, 4.2, COLOR.ice, 1.1), (m) => {
    m.position.set(0, 0.02, row - 0.3);
    m.material.uniforms.uOrigin!.value.set(mid, row);
    m.material.uniforms.uRadius!.value = 30;
    m.material.uniforms.uOpacity!.value = 0;
  });
  const sheetK = { o: 0 };
  const setSheet = () => {
    const m = sheet.get();
    if (m) m.material.uniforms.uOpacity!.value = sheetK.o;
  };
  t.to(sheetK, { o: 0.45, duration: G.dim + G.storm * 0.5, ease: EASE.land, onUpdate: setSheet }, 0);
  t.to(sheetK, { o: 0, duration: G.fade + 0.3, ease: EASE.hide, onUpdate: setSheet }, tFade);
  // 雪：从敌方随从行上空落下，持续整个风雪段（预设的发射时长就是 0.6 秒）
  at(t, tStorm - 0.12, () => scene.particles.emit(SIGNATURE_PRESETS.blizzard_fall, { at: { x: mid, y: G.height, z: row + 0.2 }, count: G.snow }));

  // 每个目标：雪落到它身上就是命中帧
  list.forEach(({ k, p, e }, n) => {
    const hit = tStorm + G.firstHit + n * G.stagger;
    place(t, cues, c.byDefault(k), hit, ['impact:hit']);
    at(t, hit, () => {
      const m = minionOf(scene, e.target);
      scene.particles.emit('frost_spread', { at: { x: p.x, y: 0, z: p.z }, count: 12, dir: 'up' });
      scene.particles.emit('ice_shatter', { at: { x: p.x, y: 0.5, z: p.z }, count: 6 });
      frostRing(scene.layers.fx, p, FREEZE.ringRadius, FREEZE.ring);
      if (m) {
        // 显示局面要到冻结那一组才冻住；先把冰壳记成冻住，后面那组同步时就不会把正在长的冰棱重置
        m.ice.setFrozen(true);
        m.ice.grow(FREEZE.grow);
        gsap.delayedCall(FREEZE.flashAt - FREEZE.growAt, () => m.ice.flash(FREEZE.flash));
        m.badges.attack.setFrost(true);
        m.badges.health.setFrost(true);
        jitter(m.body, FREEZE.shakeAmp * UNIT.base, FREEZE.shakes, FREEZE.shakeTime * FREEZE.shakes);
      }
      if (n === 0) {
        bigShake(scene, 2, down);
        bigFlash(scene, COLOR.ice, down);
        sfx('combat.freeze', p.x);
        sfx('combat.hit_heavy', p.x); // 冰击取一次重
      }
    });
  });

  // 收尾：环境光恢复
  at(t, tFade, () => dimLights(scene, 1, G.fade, EASE.land));
  span(t, tEnd);
  const firstHit = tStorm + G.firstHit;
  const lastHit = firstHit + (list.length - 1) * G.stagger;
  return { tl: t, cues, tail: Math.max(0, t.duration() - lastHit), hitAt: firstHit };
};
