// 销毁做过动画的显示对象。先停掉它和所有子对象上的 GSAP 动画再销毁：还在跑的动画去改已经销毁的
// Pixi 对象会在 GSAP 的帧回调里抛错，那一帧之后所有动画都停住。
import gsap from 'gsap';
import type { Container } from 'pixi.js';

function killTree(o: Container): void {
  gsap.killTweensOf(o);
  gsap.killTweensOf(o.scale);
  gsap.killTweensOf(o.position);
  for (const c of o.children) killTree(c as Container);
}

export function dispose(obj: Container): void {
  if (obj.destroyed) return;
  killTree(obj);
  obj.destroy({ children: true });
}

// 淡出后销毁。
export function fadeOutAndDispose(obj: Container, duration = 0.2): void {
  gsap.to(obj, { alpha: 0, duration, overwrite: 'auto', onComplete: () => dispose(obj) });
}
