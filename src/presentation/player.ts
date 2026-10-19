// 用 GSAP 播放导演交来的一步：每个事件找对应的动画模块生成时间线，合成一条并行播放，
// 播完把场景对到这一步之后的显示局面。快进（spec 5.3）把全局时间线调到三倍速，队列播空后恢复。
import gsap from 'gsap';
import type { TableScene } from '../scene/table';
import { ANIMATIONS, type AnimRegistry } from './animations';
import { composeStep } from './compose';
import type { StepPlayer } from './director';
import type { PresentationEvent } from './events';

export const FAST_FORWARD = 3;

export type GsapPlayer = {
  play: StepPlayer;
  fastForward(): void;
  resetSpeed(): void;
  readonly speed: number;
};

function playTimeline(tl: gsap.core.Timeline): Promise<void> {
  return new Promise((resolve) => {
    if (tl.duration() === 0) tl.to({}, { duration: 0.01 });
    tl.eventCallback('onComplete', () => resolve());
    tl.play(0);
  });
}

function delay(seconds: number): Promise<void> {
  return new Promise((resolve) => gsap.delayedCall(seconds, resolve));
}

export function createGsapPlayer(scene: TableScene, registry: AnimRegistry = ANIMATIONS): GsapPlayer {
  let speed = 1;
  const play: StepPlayer = async (step, before, after) => {
    const viewer = before.viewer;
    const anims = step.events.map((e, i) => {
      const module = registry[e.kind] as (ev: PresentationEvent, ctx: Parameters<AnimRegistry['draw']>[1]) => ReturnType<AnimRegistry['draw']>;
      return module(e, { scene, before: i === 0 ? before : after[i - 1], after: after[i], viewer });
    });
    await playTimeline(composeStep(anims));
    // 兜底：不管动画模块有没有自己同步，这一步结束时场景一定和显示局面一致
    if (scene.sync(after[after.length - 1])) await delay(0.3);
  };
  return {
    play,
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
}
