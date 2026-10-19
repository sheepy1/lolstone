// 销毁 3D 物件和它们占的显存。
// 几何体、材质、贴图默认归物件自己，物件销毁时一起释放；多个物件、多局之间共用的（模块级常量、卡面缓存）
// 用 shared() 标记，不释放。漏标会让共用资源被提前释放；漏释放会让每局都留一份显存，连开多局后页面崩溃。
import gsap from 'gsap';
import type * as THREE from 'three';

type HasUserData = { userData: Record<string, unknown> };

export function shared<T extends HasUserData>(x: T): T {
  x.userData.shared = true;
  return x;
}

const isShared = (x: HasUserData | null | undefined) => !x || x.userData.shared === true;

function killTree(o: THREE.Object3D): void {
  gsap.killTweensOf(o);
  gsap.killTweensOf(o.position);
  gsap.killTweensOf(o.rotation);
  gsap.killTweensOf(o.scale);
  for (const c of o.children) killTree(c);
}

const TEXTURE_KEYS = ['map', 'emissiveMap', 'alphaMap'] as const;

// 释放一棵物件树里不共用的几何体、材质、贴图（不改场景结构）。
export function releaseGpu(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh | THREE.Sprite | THREE.Points;
    const geo = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geo && !isShared(geo)) geo.dispose();
    const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (isShared(m)) continue;
      for (const k of TEXTURE_KEYS) {
        const t = (m as unknown as Record<string, THREE.Texture | null>)[k];
        if (t && !isShared(t)) t.dispose();
      }
      m.dispose();
    }
  });
}

export function dispose(obj: THREE.Object3D): void {
  killTree(obj);
  obj.removeFromParent();
  releaseGpu(obj);
}

// 缩小消失后销毁（3D 物件共用材质，不能靠改透明度淡出）。
export function fadeOutAndDispose(obj: THREE.Object3D, duration = 0.2): void {
  gsap.killTweensOf(obj.scale);
  gsap.to(obj.scale, { x: 0.01, y: 0.01, z: 0.01, duration, ease: 'power2.in', onComplete: () => dispose(obj) });
}
