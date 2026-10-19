// 受伤。随从（m4-storyboard E12，400ms，中档）：命中帧数字直接跳到新值，头像泛红（自发光红 0.6，240ms 退），
// 生命徽章弹 1 → 1.25 → 1 并闪红，底座随机抖 6 次（3% 底座宽、160ms 衰减），伤害数从徽章上方弹出上升。
// 不是攻击撞击的伤害（法术、战吼）自己在目标处冒火花，≤ 2 轻、≥ 3 重；攻击的火花由攻击动画在撞击点放。
// 被圣盾挡下时数字不变，弹白色"吸收"，碎盾交给 shield_broken。
// 英雄（E24，500ms，中 / 重）：枢纽噪声抖动（2% 枢纽宽、200ms），按剩余生命出现裂纹、缝里红光闪一下，生命数字跳变并弹，
// 红色大号飘字；伤害 3 到 4 S1，≥ 5 S2 加边缘泛红（只给我方英雄）、重火花和水晶碎片。小灯按新的生命值熄灭和闪烁（spec 5.4）。
// 命中声和震屏都报成 cue：同一步（攻击的双方、群体法术的全部目标）只播最重的一次。
import { FONT_CN } from '../../scene/theme';
import { cracksOf } from '../fx/nexusCracks';
import { combatText, tierOf } from '../fx/combatText';
import { edgeRed } from '../fx/screen';
import { FX_PALETTE } from '../fx/particles';
import { badgePoint, HERO_HIT, HIT, hitCue, hold, jitter, portraitGlow, shakeCue, targetX, UNIT } from './combat';
import type { AnimModule, Cue } from './types';
import { flash, tl, TINT } from './util';

export const damage: AnimModule<'damage'> = (e, ctx) => {
  const { scene, viewer, step } = ctx;
  const t = tl();
  const cues: Cue[] = [];
  const x = () => targetX(scene, e.target);
  const above = () => {
    const p = badgePoint(scene, e.target);
    return { x: p.x, y: p.y + HIT.textAbove * UNIT.base, z: p.z };
  };
  const inAttack = step?.some((s) => s.kind === 'attack') ?? false;

  if (e.target.kind === 'hero') {
    const H = HERO_HIT;
    const side = e.target.side;
    const hero = scene.heroes[side];
    const heavy = e.amount >= H.heavyAt;
    t.call(() => {
      const max = scene.view.players[side].hero.maxHealth;
      hero.setHealth(e.healthAfter, max);
      hero.popHealth(TINT.damage);
      const c = cracksOf(hero);
      c.setHealth(e.healthAfter, max);
      c.flash();
      if (heavy) {
        const p = scene.pointOf(e.target);
        scene.particles.emit('spark_heavy', { at: { x: p.x, y: 0.55, z: p.z + 0.4 }, count: H.sparks });
        scene.particles.emit('death_shards', { at: { x: p.x, y: 0.3, z: p.z + 0.3 }, count: H.shards, color: side === viewer ? 0x6fb4ff : 0xff6a5a });
        if (side === viewer) edgeRed(scene);
      }
    });
    t.add(jitter(hero.body, H.jitter * UNIT.nexus, 8, H.jitterTime), 0);
    t.add(flash(hero.flash, TINT.damage, H.portraitRed, 0.24), 0);
    t.add(combatText(scene.layers.top, above, `-${e.amount}`, TINT.damage, e.amount >= 3 ? 'big' : 'mid', HIT.textRise * UNIT.base), 0);
    hold(t, 0.5, 0);
    cues.push(hitCue(0, e.amount, x, true));
    if (e.amount >= H.midAt) cues.push(shakeCue(scene, 0, heavy ? 2 : 1));
    // 收尾：枢纽抖完之后（飘字上升、头像泛红消退）
    return { tl: t, cues, order: x(), stagger: HIT.stagger, tail: 0.5 - H.jitterTime };
  }

  const id = e.target.instanceId;
  const m = () => scene.minion(id);
  const absorbed = e.amount === 0 && e.shieldAbsorbed > 0;
  if (absorbed) {
    // 数字不变；"吸收"白字，护盾碎裂由 shield_broken 做
    t.add(combatText(scene.layers.top, above, '吸收', FX_PALETTE.shield, 'small', HIT.textRise * UNIT.base, FONT_CN), 0);
    t.call(() => {
      const v = m();
      if (v) jitter(v.body, HIT.shakeAmp * UNIT.base * 0.6, 3, HIT.shakeTime * 0.6);
    });
    hold(t, 0.4, 0);
    return { tl: t, cues, order: x(), stagger: HIT.stagger, tail: 0.4 - HIT.shakeTime };
  }
  t.call(() => {
    const v = m();
    if (!v) return;
    v.showHealth(e.healthAfter);
    v.badges.health.pop(TINT.damage, HIT.badgeScale, HIT.badgeTime, HIT.badgeFlash);
    portraitGlow(v, TINT.damage, HIT.redGlow, HIT.redFade);
    jitter(v.body, HIT.shakeAmp * UNIT.base, HIT.shakes, HIT.shakeTime);
    if (!inAttack) {
      const p = scene.pointOf(e.target);
      const heavy = e.amount >= HIT.heavyAt;
      scene.particles.emit(heavy ? 'spark_heavy' : 'spark_light', { at: { x: p.x, y: 0.4, z: p.z }, count: heavy ? HIT.sparkHeavy : HIT.sparkLight });
    }
  });
  t.add(combatText(scene.layers.top, above, `-${e.amount}`, TINT.damage, tierOf(e.amount), HIT.textRise * UNIT.base), 0);
  if (e.lethalPrevented) {
    t.add(combatText(scene.layers.top, () => ({ ...above(), y: above().y + 0.5 }), '免死', 0xffd070, 'small', HIT.textRise * UNIT.base, FONT_CN), 0.15);
  }
  hold(t, 0.4, 0);
  if (e.amount > 0) cues.push(hitCue(0, e.amount, x));
  // 收尾：分镜 E12 抖动之后的飘字和泛红消退
  return { tl: t, cues, order: x(), stagger: HIT.stagger, tail: 0.4 - HIT.shakeTime };
};
