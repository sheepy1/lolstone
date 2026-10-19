// 动画模块共用的小工具。只放和具体事件无关的东西，模块之间不互相引用。
import gsap from 'gsap';
import type { Container } from 'pixi.js';
import type { Side, TargetRef } from '../../engine';
import type { TableScene } from '../../scene/table';
import type { Point } from '../fx/arrow';

export const tl = (): gsap.core.Timeline => gsap.timeline();

export function sideColor(side: Side, viewer: Side): number {
  return side === viewer ? 0x6fd0ff : 0xff8a6f;
}

// 抖一下（受伤、被撞）。
export function shake(target: Container, strength = 8, duration = 0.3): gsap.core.Timeline {
  const t = gsap.timeline();
  const n = 6;
  for (let i = 0; i < n; i++) {
    t.to(target, { x: (i % 2 === 0 ? 1 : -1) * strength * (1 - i / n), duration: duration / (n + 1), ease: 'none' });
  }
  t.to(target, { x: 0, duration: duration / (n + 1) });
  return t;
}

// 闪一下：flash 是显示对象上预先放好的一层纯色覆层，alpha 从 peak 降到 0。
export function flash(overlay: Container, tint: number, peak = 0.8, duration = 0.3): gsap.core.Timeline {
  const t = gsap.timeline();
  t.call(() => {
    overlay.tint = tint;
  });
  t.fromTo(overlay, { alpha: peak }, { alpha: 0, duration, ease: 'power2.out', immediateRender: false });
  return t;
}

// 惰性取坐标：时间线播放时才算，跟上中途移动的对象。
export function pointOf(scene: TableScene, ref: TargetRef): () => Point {
  return () => scene.pointOf(ref);
}

export function at(p: Point): () => Point {
  return () => p;
}

// 把场景对到显示局面，并给布局滑动留出时间。
export function syncTo(scene: TableScene, view: Parameters<TableScene['sync']>[0], duration = 0.3): gsap.core.Timeline {
  const t = gsap.timeline();
  t.call(() => {
    scene.sync(view, duration);
  });
  t.to({}, { duration });
  return t;
}
