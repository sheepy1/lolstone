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

// 只有边缘亮的透明外壳（菲涅尔）：正对镜头的地方几乎透明，越靠轮廓越亮。加色混合、不写深度，
// 所以不挡住壳里后画的东西，也进不了选择性泛光。base 是正中的亮度，rim 是轮廓处加上的亮度，power 越大亮边越窄。
// uniforms.color 可以改，改它就改整个壳的颜色和亮度。
export function fresnelMaterial(color: THREE.Color, base = 0.03, rim = 0.85, power = 3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color } },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), ${power.toFixed(2)});
        gl_FragColor = vec4(color * (${base.toFixed(3)} + ${rim.toFixed(3)} * f), 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
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
