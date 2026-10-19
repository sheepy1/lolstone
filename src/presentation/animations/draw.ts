// 抽牌：牌从牌库飞到手牌末位，手牌重排扇形。
import { playSfx } from '../../audio';
import type { AnimModule } from './types';
import { syncTo, tl } from './util';

export const draw: AnimModule<'draw'> = (_e, { scene, after }) => {
  const t = tl();
  t.call(() => playSfx('card.draw'));
  t.add(syncTo(scene, after, 0.45));
  return { tl: t };
};
