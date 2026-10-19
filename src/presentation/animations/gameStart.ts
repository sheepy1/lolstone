// 换牌结束、对局开始：起手牌从换牌的大排面收进手牌扇形，压暗板撤掉。先后手已经在开局演出（E01）里交代过。
import type { AnimModule } from './types';
import { syncTo, tl } from './util';

export const gameStart: AnimModule<'game_start'> = (_e, { scene, after }) => {
  const t = tl();
  t.add(syncTo(scene, after, 0.4));
  return { tl: t };
};
