// 粒子着色器。每个粒子是一个实例化的四边形：朝向、大小、位置全在实例矩阵里（CPU 每帧算好），
// 颜色和透明度在 iColor，图集格子和软粒子开关在 iMisc。
//
// 三种材质：
//   alpha  普通透明混合，不写深度（烟、尘、碎片、纸屑），按远到近排序后画；
//   add    加法混合，不写深度（大面积的闪光、光柱、冲击环）；
//   core   只写深度、不写颜色，丢掉覆盖率低的像素。进泛光的粒子用它：选择性泛光按深度对上被选中物件的像素
//          （stage.ts），所以发光粒子的亮核必须写深度；同一批粒子再用 add 材质画一遍颜色。
//
// 顶点变换写成 modelViewMatrix * (instanceMatrix * position)，和 three 的 MeshDepthMaterial 完全同一个顺序：
// 泛光的深度通道用 MeshDepthMaterial 重画被选中的物件，两边算出来的深度要逐位相等才对得上。
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS } from './atlas';

export type ParticleMaterialKind = 'alpha' | 'add' | 'core';

const vertexShader = /* glsl */ `
attribute vec4 iColor;
attribute float iMisc;
uniform vec2 uCells;
varying vec2 vUv;
varying vec4 vColor;
varying float vSoft;
varying float vWorldY;
varying float vViewZ;

void main() {
  float cell = mod(iMisc, 8.0);
  vSoft = step(7.5, iMisc);
  vec2 cellXY = vec2(mod(cell, uCells.x), floor(cell / uCells.x));
  vUv = (cellXY + uv) / uCells;
  vColor = iColor;
  vec4 local = instanceMatrix * vec4(position, 1.0);
  vWorldY = (modelMatrix * local).y;
  vec4 mvPosition = modelViewMatrix * local;
  vViewZ = mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
#include <packing>
uniform sampler2D uMap;
uniform float uGroundY;
uniform float uSoftRange;
#ifdef SOFT_DEPTH
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
#endif
varying vec2 vUv;
varying vec4 vColor;
varying float vSoft;
varying float vWorldY;
varying float vViewZ;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vColor.a;
  if (vSoft > 0.5) {
#ifdef SOFT_DEPTH
    // 软粒子：和场景深度差得越小越透明
    float d = texture2D(uDepth, gl_FragCoord.xy / uResolution).x;
    float sceneZ = perspectiveDepthToViewZ(d, uNear, uFar);
    a *= clamp((vViewZ - sceneZ) / uSoftRange, 0.0, 1.0);
#else
    // 没有深度贴图时退一步：贴近台面（y = uGroundY）时淡出
    a *= clamp((vWorldY - uGroundY) / uSoftRange, 0.0, 1.0);
#endif
  }
#ifdef DEPTH_ONLY
  if (a < 0.35) discard;
  gl_FragColor = vec4(0.0);
#else
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb * tex.rgb, a);
  #include <colorspace_fragment>
#endif
}
`;

export function createParticleMaterial(kind: ParticleMaterialKind, atlas: THREE.Texture): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: atlas },
      uCells: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
      uGroundY: { value: 0 },
      uSoftRange: { value: 0.08 },
      uDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: kind === 'core',
    colorWrite: kind !== 'core',
    blending: kind === 'add' ? THREE.AdditiveBlending : kind === 'alpha' ? THREE.NormalBlending : THREE.NoBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  if (kind === 'core') m.defines = { DEPTH_ONLY: '' };
  m.name = `particles-${kind}`;
  return m;
}
