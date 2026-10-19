// 冻结：冰层覆上，冰晶粒子。
import { playSfx } from '../../audio';
import { burst, floatText } from '../fx/effects';
import type { AnimModule } from './types';
import { flash, pointOf, syncTo, tl } from './util';

export const freeze: AnimModule<'freeze'> = (e, { scene, after }) => {
  const t = tl();
  const where = pointOf(scene, e.target);
  const body = scene.targetBody(e.target);
  t.call(() => playSfx('combat.freeze'));
  if (body) t.add(flash(body.flash, 0x9fe2ff, 0.9, 0.4), 0);
  t.add(burst(scene.layers.fx, where, 0xc9f0ff, 14, 0.4), 0);
  t.add(floatText(scene.layers.fx, where, '冻结', 0x9fe2ff, 32), 0);
  t.add(syncTo(scene, after, 0.1), 0.2);
  return { tl: t };
};
