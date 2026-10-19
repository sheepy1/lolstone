// 回合开始：我方回合横幅"你的回合"滑入停顿再淡出，结束回合按钮亮起。对方回合开始只短暂停顿
// （"对方回合"横幅在我方结束回合时已经出过）。
import { playSfx } from '../../audio';
import { banner } from '../fx/effects';
import { bannerSlot } from '../layout';
import type { AnimModule } from './types';
import { syncTo, tl } from './util';

export const turnStart: AnimModule<'turn_start'> = (e, { scene, after, viewer }) => {
  const t = tl();
  t.call(() => playSfx('flow.turn_start'));
  if (e.side === viewer) {
    t.add(banner(scene.layers.top, bannerSlot(), '你的回合', 0xffe08a, 0.5));
    t.add(syncTo(scene, after, 0.2), 0.3);
  } else {
    t.add(syncTo(scene, after, 0.3));
  }
  return { tl: t };
};
