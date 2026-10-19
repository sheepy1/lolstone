// 用 GSAP 播放导演交来的一步：每个事件找对应的动画模块生成时间线，合成一条并行播放，
// 播完把场景对到这一步之后的显示局面。快进（spec 5.3）把全局时间线调到三倍速，队列播空后恢复。
import gsap from 'gsap';
import type { TableScene } from '../scene/table';
import { ANIMATIONS, type AnimRegistry } from './animations';
import { composeStep } from './compose';
import type { StepPlayer } from './director';
import type { PresentationEvent } from './events';

export const FAST_FORWARD = 3;

// 调试台用的整步调节：duration 是时长倍数，ease 把整条时间线的进度重新映射到一条缓动曲线上。
// 不改动画模块本身，M4 在调试台上试出合适的值后再写回模块。
export type StepTuning = { duration: number; ease: string | null };

export type GsapPlayer = {
  play: StepPlayer;
  tune: StepTuning;
  // 每步合成好的时间线（调试台拿去接 GSDevTools）
  onTimeline: ((tl: gsap.core.Timeline) => void) | null;
  fastForward(): void;
  resetSpeed(): void;
  readonly speed: number;
};

function playTimeline(tl: gsap.core.Timeline, tune: StepTuning): Promise<void> {
  return new Promise((resolve) => {
    if (tl.duration() === 0) tl.to({}, { duration: 0.01 });
    if (tune.duration === 1 && !tune.ease) {
      tl.eventCallback('onComplete', () => resolve());
      tl.play(0);
      return;
    }
    // 暂停的时间线由一个补间推着走：时长按倍数伸缩，进度按缓动曲线映射
    tl.pause(0);
    gsap.to(tl, { progress: 1, duration: tl.duration() * tune.duration, ease: tune.ease ?? 'none', onComplete: () => resolve() });
  });
}

function delay(seconds: number): Promise<void> {
  return new Promise((resolve) => gsap.delayedCall(seconds, resolve));
}

export function createGsapPlayer(scene: TableScene, registry: AnimRegistry = ANIMATIONS): GsapPlayer {
  let speed = 1;
  let seq = 0;
  const tune: StepTuning = { duration: 1, ease: null };
  // 返回 { ready, done }（m4-storyboard 1.7 组间重叠）：ready 在这一步最后结束的事件收尾进行到 60% 时完成，导演这时开始下一组；
  // done 在整步播完、兜底同步完成时完成。调试台改了整步时长或缓动时不重叠（ready 就是整步结束）。
  const play: StepPlayer = (step, before, after) => {
    const id = ++seq;
    const last = after[after.length - 1];
    scene.markViews(after, id);
    const viewer = before.viewer;
    const anims = step.events.map((e, i) => {
      const module = registry[e.kind] as (ev: PresentationEvent, ctx: Parameters<AnimRegistry['draw']>[1]) => ReturnType<AnimRegistry['draw']>;
      return module(e, { scene, before: i === 0 ? before : after[i - 1], after: after[i], viewer, step: step.events, index: i });
    });
    const master = composeStep(anims);
    api.onTimeline?.(master);
    let markReady = () => {};
    const ready = new Promise<void>((resolve) => (markReady = resolve));
    const plain = tune.duration === 1 && !tune.ease;
    const readyAt = plain ? ((master.data as { ready?: number } | undefined)?.ready ?? master.duration()) : master.duration();
    if (readyAt < master.duration() - 1e-3) master.call(markReady, undefined, readyAt);
    const done = (async () => {
      try {
        await playTimeline(master, tune);
      } finally {
        markReady();
      }
      // 兜底：不管动画模块有没有自己同步，这一步结束时场景一定和显示局面一致。后面的组已经开始时不做，
      // 它们会同步到更新的局面；这时同步回这一步的局面，会把后面那组刚放上去的东西又挪走
      if (id === seq && scene.sync(last)) await delay(0.3);
    })();
    return { ready, done };
  };
  const api: GsapPlayer = {
    play,
    tune,
    onTimeline: null,
    fastForward() {
      speed = FAST_FORWARD;
      gsap.globalTimeline.timeScale(speed);
    },
    resetSpeed() {
      speed = 1;
      gsap.globalTimeline.timeScale(1);
    },
    get speed() {
      return speed;
    },
  };
  return api;
}
