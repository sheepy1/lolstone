// 销毁做过动画的 3D 物件。先停掉它和所有子物件上的 GSAP 动画再移除：还在跑的动画去改已经移除的
// 物件不会报错，但会白白占着时间线；材质和贴图只释放标了 userData.owned 的（共用的不能释放）。
import gsap from 'gsap';
import type * as THREE from 'three';

function killTree(o: THREE.Object3D): void {
  gsap.killTweensOf(o);
  gsap.killTweensOf(o.position);
  gsap.killTweensOf(o.rotation);
  gsap.killTweensOf(o.scale);
  for (const c of o.children) killTree(c);
}

export function dispose(obj: THREE.Object3D): void {
  killTree(obj);
  obj.removeFromParent();
  obj.traverse((o) => {
    if (!o.userData.owned) return;
    const mesh = o as THREE.Mesh | THREE.Sprite;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map && map.userData.owned) map.dispose();
      m.dispose();
    }
  });
}

// 缩小消失后销毁（3D 物件共用材质，不能靠改透明度淡出）。
export function fadeOutAndDispose(obj: THREE.Object3D, duration = 0.2): void {
  gsap.killTweensOf(obj.scale);
  gsap.to(obj.scale, { x: 0.01, y: 0.01, z: 0.01, duration, ease: 'power2.in', onComplete: () => dispose(obj) });
}
