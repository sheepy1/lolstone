// 换牌开始：起手牌从牌库飞出，排到中央。
import { playSfx } from '../../audio';
import type { AnimModule } from './types';
import { syncTo, tl } from './util';

export const mulliganStart: AnimModule<'mulligan_start'> = (_e, { scene, after }) => {
  const t = tl();
  t.call(() => playSfx('card.draw'));
  t.add(syncTo(scene, after, 0.6));
  return { tl: t };
};
