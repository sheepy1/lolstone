// 发光材质预设（spec 5.4、6.1）。哪些东西泛光由图层决定，不靠亮度阈值：打开 BLOOM_LAYER 的物件进选择性泛光
// （stage.ts），其余一律不泛光。泛光是按深度对上选中物件的像素来取的，所以要泛光的材质必须写深度。
import * as THREE from 'three';

// 选择性泛光用的图层（0 是普通渲染层，物件同时开着 0 和这一层）
export const BLOOM_LAYER = 11;

// 打开或关掉一棵物件树的泛光（图层不继承，要逐个网格设置）
export function markBloom(obj: THREE.Object3D, on = true): void {
  obj.traverse((o) => {
    if (on) o.layers.enable(BLOOM_LAYER);
    else o.layers.disable(BLOOM_LAYER);
  });
}

// 颜色乘强度后的 HDR 颜色
export function hdr(hex: number, intensity: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

// 发光边、准星、箭头用的不受光照材质
export function glowMaterial(hex: number, intensity = EDGE_GLOW): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: hdr(hex, intensity), toneMapped: false });
}

// 发光边的亮度。泛光只认图层，这里只决定边框本身多亮
export const EDGE_GLOW = 1.6;

// 叠加的闪光层：默认透明，动画把 opacity 拉上去再降下来
export function flashMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}
