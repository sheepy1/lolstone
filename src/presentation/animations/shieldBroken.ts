// 圣盾被打破：血条末端的白色护盾段碎成光点。
import { playSfx } from '../../audio';
import { burst, floatText } from '../fx/effects';
import type { AnimModule } from './types';
import { pointOf, syncTo, tl } from './util';

export const shieldBroken: AnimModule<'shield_broken'> = (e, { scene, after }) => {
  const t = tl();
  const where = pointOf(scene, e.target);
  const top = () => ({ ...where(), y: where().y + 0.5 });
  t.call(() => playSfx('combat.shield_break'));
  t.add(burst(scene.layers.fx, top, 0xffffff, 18, 0.4), 0);
  t.add(floatText(scene.layers.fx, top, '破盾', 0xffffff, 30), 0);
  t.add(syncTo(scene, after, 0.1), 0.15);
  return { tl: t };
};
