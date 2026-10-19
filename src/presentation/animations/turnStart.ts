// 回合开始（m4-storyboard E02，1200ms）：横幅"你的回合"从中央上方滑入（250ms 落，缩放 0.9 到 1，光扫一遍），
// 停顿 500ms 给玩家读字，再向上滑出淡出（250ms 起）。结束回合按钮在滑入的同时翻回正面亮起（按钮自己的动画）。
// 这一步的时间线只到停顿中段：后面的法力变化（E25）和抽牌（E03）接着播，滑出在后台走完，
// 抽牌刚好在滑出开始时起飞（分镜的"衔接"）。对方回合开始不出横幅（"对方回合"在我方结束回合时已经出过）。
// 声音：flow.turn_start 在 t=0。
import { playSfx } from '../../audio';
import { Banner, FLOW, WARM } from '../fx/flow';
import { bannerSlot } from '../layout';
import type { AnimModule } from './types';
import { syncTo, tl } from './util';

export const turnStart: AnimModule<'turn_start'> = (e, { scene, after, viewer }) => {
  const t = tl();
  if (e.side !== viewer) {
    t.add(syncTo(scene, after, 0.3));
    return { tl: t, tail: 0.3 }; // 对方回合开始：只有布局滑动，整段都算收尾
  }
  const banner = new Banner(scene.stage, scene.layers.top, bannerSlot().pos, '你的回合', WARM);
  t.call(() => {
    playSfx('flow.turn_start');
    // 横幅整段（滑入、停顿、滑出）在后台走，不占这一步的时长
    const run = banner.in();
    run.add(banner.out());
  });
  t.add(syncTo(scene, after, 0.2), 0);
  // 这一步在停顿进行到 40% 时结束：法力条（300ms）接着在停顿里点亮，抽牌正好在滑出开始时起飞
  t.to({}, { duration: TURN_START_STEP() }, 0);
  return { tl: t };
};

export const TURN_START_STEP = (): number => FLOW.bannerIn + FLOW.bannerHold * 0.4;
