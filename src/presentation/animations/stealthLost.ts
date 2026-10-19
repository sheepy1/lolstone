// 失去潜行：一卷浅色烟雾散开，标出"现身"，头像恢复不透明。
import { playSfx } from '../../audio';
import { burst, floatText, ring } from '../fx/effects';
import type { AnimModule } from './types';
import { pointOf, syncTo, tl } from './util';

export const stealthLost: AnimModule<'stealth_lost'> = (e, { scene, after }) => {
  const t = tl();
  const where = pointOf(scene, e.target);
  t.call(() => playSfx('combat.stealth'));
  t.add(ring(scene.layers.fx, where, 0xd8d8f0, 130, 0.45), 0);
  t.add(burst(scene.layers.fx, where, 0xe0e0f0, 40, 0.55), 0);
  t.add(floatText(scene.layers.top, where, '现身', 0xe8e8ff, 34), 0);
  t.add(syncTo(scene, after, 0.1), 0.15);
  return { tl: t };
};
