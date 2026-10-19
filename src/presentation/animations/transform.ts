// 变形：原形象闪白炸开，新形象在原地出现。
import { playSfx } from '../../audio';
import { burst } from '../fx/effects';
import type { AnimModule } from './types';
import { flash, pointOf, syncTo, tl } from './util';

export const transform: AnimModule<'transform'> = (e, { scene, after }) => {
  const t = tl();
  const old = scene.targetBody(e.target);
  const where = pointOf(scene, e.target);
  t.call(() => playSfx('card.transform'));
  if (old) t.add(flash(old.flash, 0xffffff, 1, 0.3), 0);
  t.add(burst(scene.layers.fx, where, 0xffffff, 20, 0.4), 0.2);
  t.add(syncTo(scene, after, 0.3), 0.2);
  return { tl: t };
};
