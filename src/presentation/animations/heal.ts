// 治疗（m4-storyboard E13，400ms，轻档）：命中帧数字跳到新值，生命徽章弹一下并闪绿，头像绿色自发光 0.3，
// heal_motes 光点上升，绿色"+N"飘字上升。治疗声在 t=0，带声像。英雄的裂纹按新的生命值退掉。
import { cracksOf } from '../fx/nexusCracks';
import { combatText, tierOf } from '../fx/combatText';
import { badgePoint, HEAL, HIT, hold, portraitGlow, sfxAt, targetX, UNIT } from './combat';
import type { AnimModule } from './types';
import { flash, TINT, tl } from './util';

export const heal: AnimModule<'heal'> = (e, { scene }) => {
  const t = tl();
  const x = targetX(scene, e.target);
  const above = () => {
    const p = badgePoint(scene, e.target);
    return { x: p.x, y: p.y + HIT.textAbove * UNIT.base, z: p.z };
  };
  t.call(() => {
    sfxAt('combat.heal', x);
    const p = scene.pointOf(e.target);
    scene.particles.emit('heal_motes', { at: { x: p.x, y: 0, z: p.z }, count: HEAL.motes });
    if (e.target.kind === 'hero') {
      const hero = scene.heroes[e.target.side];
      const max = scene.view.players[e.target.side].hero.maxHealth;
      hero.setHealth(e.healthAfter, max);
      hero.popHealth(TINT.heal);
      cracksOf(hero).setHealth(e.healthAfter, max);
      flash(hero.flash, TINT.heal, HEAL.glow, HEAL.glowFade);
      return;
    }
    const m = scene.minion(e.target.instanceId);
    if (!m) return;
    m.showHealth(e.healthAfter);
    m.badges.health.pop(TINT.heal, HIT.badgeScale, HIT.badgeTime, HIT.badgeFlash);
    portraitGlow(m, TINT.heal, HEAL.glow, HEAL.glowFade);
  });
  t.add(combatText(scene.layers.top, above, `+${e.amount}`, TINT.heal, tierOf(e.amount), HIT.textRise * UNIT.base), 0);
  hold(t, 0.4, 0);
  return { tl: t, order: x, stagger: HEAL.stagger };
};
