// 对局开始：横幅，手牌从换牌布局收进扇形。
import { banner } from '../fx/effects';
import { bannerSlot } from '../layout';
import type { AnimModule } from './types';
import { syncTo, tl } from './util';

export const gameStart: AnimModule<'game_start'> = (e, { scene, after, viewer }) => {
  const t = tl();
  t.add(syncTo(scene, after, 0.4));
  t.add(banner(scene.layers.top, bannerSlot(), e.first === viewer ? '你先手' : '对手先手', 0xf0e0b0, 0.4, 64), 0);
  return { tl: t };
};
