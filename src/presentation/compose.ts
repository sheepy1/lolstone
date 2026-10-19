// 把一步里各事件的时间线合成一条（spec 5.5）：同一步的事件并行播放；有带 impact 的事件（攻击）时，
// 其余事件从最晚的 impact 时刻开始，和攻击动画重叠。
import gsap from 'gsap';

export type Placed = { tl: gsap.core.Timeline; impact?: number };

export function composeStep(anims: readonly Placed[]): gsap.core.Timeline {
  const master = gsap.timeline({ paused: true });
  const impacts = anims.filter((a) => a.impact !== undefined).map((a) => a.impact!);
  const followAt = impacts.length > 0 ? Math.max(...impacts) : 0;
  for (const a of anims) master.add(a.tl, a.impact !== undefined ? 0 : followAt);
  return master;
}

// 每条子时间线在合成结果里的开始时刻，测试用。
export function startTimes(master: gsap.core.Timeline): number[] {
  return master.getChildren(false, true, true).map((c) => c.startTime());
}
