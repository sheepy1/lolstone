// 动画模块共用的小工具。只放和具体事件无关的东西，模块之间不互相引用。
import gsap from 'gsap';
import type * as THREE from 'three';
import type { Side, TargetRef } from '../../engine';
import type { TableScene } from '../../scene/table';
import type { Point } from '../fx/arrow';
import type { Slot } from '../layout';

export const tl = (): gsap.core.Timeline => gsap.timeline();

export function sideColor(side: Side, viewer: Side): number {
  return side === viewer ? 0x6fd0ff : 0xff8a6f;
}

// 抖一下（受伤、被撞）：在 x 方向来回晃，target 是物件的 body。
export function shake(target: THREE.Object3D, strength = 0.08, duration = 0.3): gsap.core.Timeline {
  const t = gsap.timeline();
  const n = 6;
  for (let i = 0; i < n; i++) {
    t.to(target.position, { x: (i % 2 === 0 ? 1 : -1) * strength * (1 - i / n), duration: duration / (n + 1), ease: 'none' });
  }
  t.to(target.position, { x: 0, duration: duration / (n + 1) });
  return t;
}

// 闪一下：overlay 是物件上预先放好的叠加层（加色混合），不透明度从 peak 降到 0。
export function flash(overlay: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, tint: number, peak = 0.8, duration = 0.3): gsap.core.Timeline {
  const t = gsap.timeline();
  t.call(() => {
    overlay.material.color.setHex(tint);
  });
  t.fromTo(overlay.material, { opacity: peak }, { opacity: 0, duration, ease: 'power2.out', immediateRender: false });
  return t;
}

// 把物件滑到槽位（位置、朝向、缩放一起）。
export function toSlot(obj: THREE.Object3D, s: Slot, duration: number, ease = 'power2.out'): gsap.core.Timeline {
  const t = gsap.timeline();
  t.to(obj.position, { ...s.pos, duration, ease }, 0);
  t.to(obj.rotation, { ...s.rot, duration, ease }, 0);
  t.to(obj.scale, { x: s.scale, y: s.scale, z: s.scale, duration, ease }, 0);
  return t;
}

// 惰性取坐标：时间线播放时才算，跟上中途移动的物件。
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
