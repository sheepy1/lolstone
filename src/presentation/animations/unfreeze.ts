// 解冻：冰层碎开。
import { playSfx } from '../../audio';
import { burst } from '../fx/effects';
import type { AnimModule } from './types';
import { pointOf, syncTo, tl } from './util';

export const unfreeze: AnimModule<'unfreeze'> = (e, { scene, after }) => {
  const t = tl();
  t.call(() => playSfx('combat.unfreeze'));
  t.add(burst(scene.layers.fx, pointOf(scene, e.target), 0xe0f6ff, 12, 0.35), 0);
  t.add(syncTo(scene, after, 0.1), 0.15);
  return { tl: t };
};
