// 结束回合（m4-storyboard E26，800ms）：按下 80ms 在输入层（点按钮时按钮自己压下、ui.button 一声）；
// 变暗 200ms：按钮翻到背面"对方回合"、脉动停止；横幅"对方回合" 500ms，冷色、缩放 0.85，节奏同 E02 压缩。
// 对手结束回合时不出横幅（接下来我方回合开始的横幅"你的回合"就是提示）。
// 声音：flow.turn_end 在横幅 t=0。
import { playSfx } from '../../audio';
import { wait } from '../fx/effects';
import { Banner, COLD } from '../fx/flow';
import { bannerSlot } from '../layout';
import type { AnimModule } from './types';
import { tl } from './util';

export const TURN_END = { dim: 0.2, bannerIn: 0.15, bannerHold: 0.2, bannerOut: 0.15 };

export const turnEnd: AnimModule<'turn_end'> = (e, { scene, viewer }) => {
  const t = tl();
  if (e.side !== viewer) {
    t.add(wait(0.2));
    return { tl: t, tail: 0.2 }; // 对手结束回合：只是停顿
  }
  const P = TURN_END;
  const banner = new Banner(scene.stage, scene.layers.top, bannerSlot().pos, '对方回合', COLD);
  t.call(() => scene.endTurn.setMode('theirs', false));
  t.call(() => playSfx('flow.turn_end'), undefined, P.dim);
  t.add(banner.in(P.bannerIn, P.bannerHold), P.dim);
  t.add(banner.out(P.bannerOut));
  return { tl: t, tail: TURN_END.bannerOut };
};
