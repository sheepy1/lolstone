// 发光材质预设（spec 5.4）：发光的东西靠超过 bloom 阈值（stage.ts 的 BLOOM_THRESHOLD = 2.2）的亮度做，
// 不靠描边贴图。toneMapped 关掉，颜色乘上强度后直接进 bloom 的高亮提取。强度 1 到 2 不泛光，4 以上泛光。
import * as THREE from 'three';

// 颜色乘强度后的 HDR 颜色
export function hdr(hex: number, intensity: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

// 发光边、准星、箭头用的不受光照材质
export function glowMaterial(hex: number, intensity = 4, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hdr(hex, intensity),
    toneMapped: false,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
}

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
