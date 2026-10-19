// 把一步里各事件的时间线合成一条（spec 5.5、m4-storyboard 1.7）：同一步的事件并行播放；有带 impact 的事件（攻击）时，
// 其余事件从最晚的 impact 时刻开始，和攻击动画重叠。没有攻击时，带 stagger 的事件按目标从左到右错开成一道波。
// 各事件报上来的 cue（震屏、命中声、语音）每个频道只留一条。
import gsap from 'gsap';

export type PlacedCue = { channel: string; at: number; weight: number; run: () => void; many?: () => void };
export type Placed = { tl: gsap.core.Timeline; impact?: number; cues?: PlacedCue[]; order?: number; stagger?: number };

// 每条事件时间线在整步里的开始时刻
export function placeStarts(anims: readonly Placed[]): number[] {
  const impacts = anims.filter((a) => a.impact !== undefined).map((a) => a.impact!);
  const followAt = impacts.length > 0 ? Math.max(...impacts) : 0;
  const starts = anims.map((a) => (a.impact !== undefined ? 0 : followAt));
  if (impacts.length > 0) return starts;
  // 同一个目标上的多个事件（伤害加冻结）算同一格，不同目标按横坐标排名错开
  const xs = [...new Set(anims.filter((a) => a.stagger !== undefined && a.order !== undefined).map((a) => round(a.order!)))].sort((p, q) => p - q);
  if (xs.length < 2) return starts;
  return anims.map((a, i) => (a.stagger !== undefined && a.order !== undefined ? starts[i] + xs.indexOf(round(a.order)) * a.stagger : starts[i]));
}

const round = (x: number) => Math.round(x * 100) / 100;

// 每个频道挑一条 cue，返回 [绝对时刻, 要调用的函数]
export function pickCues(anims: readonly Placed[], starts: readonly number[]): { channel: string; time: number; run: () => void }[] {
  const byChannel = new Map<string, { cue: PlacedCue; time: number; n: number; first: number }>();
  anims.forEach((a, i) => {
    for (const cue of a.cues ?? []) {
      const time = starts[i] + cue.at;
      const cur = byChannel.get(cue.channel);
      if (!cur) {
        byChannel.set(cue.channel, { cue, time, n: 1, first: time });
        continue;
      }
      cur.n++;
      cur.first = Math.min(cur.first, time);
      const better = cue.channel === 'voice' ? time >= cur.time : cue.weight > cur.cue.weight;
      if (better) Object.assign(cur, { cue, time });
    }
  });
  return [...byChannel.entries()].map(([channel, c]) => ({
    channel,
    // 语音跟着最后一个；其余放在这一频道最早的那个时刻（一道波的第一个命中帧），只是强度取最重的
    time: channel === 'voice' ? c.time : c.first,
    run: c.n > 1 && c.cue.many ? c.cue.many : c.cue.run,
  }));
}

export function composeStep(anims: readonly Placed[]): gsap.core.Timeline {
  const master = gsap.timeline({ paused: true });
  const starts = placeStarts(anims);
  anims.forEach((a, i) => master.add(a.tl, starts[i]));
  for (const c of pickCues(anims, starts)) master.call(c.run, undefined, c.time);
  return master;
}

// 每条事件时间线在合成结果里的开始时刻，测试用（cue 是单独的回调，不算在内）。
export function startTimes(master: gsap.core.Timeline): number[] {
  return master.getChildren(false, false, true).map((c) => c.startTime());
}
