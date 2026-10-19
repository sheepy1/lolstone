// 治疗：绿色治疗飘字，生命徽章数字跳变、徽章弹一下并闪绿，上升的光点。
import { playSfx } from '../../audio';
import { burst, floatText } from '../fx/effects';
import type { AnimModule } from './types';
import { flash, pointOf, popStat, TINT, tl } from './util';

export const heal: AnimModule<'heal'> = (e, { scene }) => {
  const t = tl();
  const body = scene.targetBody(e.target);
  const where = pointOf(scene, e.target);
  t.call(() => {
    playSfx('combat.heal');
    if (e.target.kind === 'hero') scene.heroes[e.target.side].setHealth(e.healthAfter, scene.view.players[e.target.side].hero.maxHealth);
    else scene.minion(e.target.instanceId)?.showHealth(e.healthAfter);
  });
  t.add(popStat(scene, e.target, 'health', TINT.heal), 0);
  if (body) t.add(flash(body.flash, 0x40ff60, 0.6, 0.35), 0);
  t.add(floatText(scene.layers.fx, where, `+${e.amount}`, 0x50ff70, 48), 0);
  t.add(burst(scene.layers.fx, where, 0x80ff90, 10, 0.4), 0);
  return { tl: t };
};
