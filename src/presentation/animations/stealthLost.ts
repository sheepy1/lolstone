// 失去潜行：一卷烟散开，头像恢复不透明。
import { playSfx } from '../../audio';
import { burst, ring } from '../fx/effects';
import type { AnimModule } from './types';
import { pointOf, syncTo, tl } from './util';

export const stealthLost: AnimModule<'stealth_lost'> = (e, { scene, after }) => {
  const t = tl();
  const where = pointOf(scene, e.target);
  t.call(() => playSfx('combat.stealth'));
  t.add(ring(scene.layers.fx, where, 0x707080, 90, 0.35), 0);
  t.add(burst(scene.layers.fx, where, 0x606070, 16, 0.4), 0);
  t.add(syncTo(scene, after, 0.1), 0.15);
  return { tl: t };
};
