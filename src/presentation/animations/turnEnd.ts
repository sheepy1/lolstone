// 结束回合：按钮变暗显示"对方回合"，横幅"对方回合"。
import { playSfx } from '../../audio';
import { banner, wait } from '../fx/effects';
import { bannerSlot } from '../layout';
import type { AnimModule } from './types';
import { tl } from './util';

export const turnEnd: AnimModule<'turn_end'> = (e, { scene, viewer }) => {
  const t = tl();
  t.call(() => {
    playSfx('flow.turn_end');
    scene.endTurn.setMode('theirs', false);
  });
  if (e.side === viewer) t.add(banner(scene.layers.top, bannerSlot(), '对方回合', 0xd0d8e8, 0.2, 64));
  else t.add(wait(0.25));
  return { tl: t };
};
