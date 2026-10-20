// 棋盘地面和河水的着色器（M4 美术）。都在 MeshStandardMaterial 上改（onBeforeCompile），光照、阴影照旧走 three；
// 只替换"表面是什么颜色、什么法线、多粗糙"这几段。程序纹理来自 boardTextures.ts，加载时生成一次。
// 地面分五层，按遮罩和噪声混：
//   草地（三种绿按大、中两级噪声混，乘草叶明暗，草叶法线）→ 土路（随从行，两种土色加碎石，边缘被草叶咬碎）
//   → 湿泥和卵石（河岸，粗糙度低、看起来是湿的）→ 河床（深色，带缓慢流动的焦散亮纹）→ 山石（野区高处和陡坡，顶上长苔）。
// 最后整体压饱和度、外圈压暗，让中间的随从和卡牌更突出（BOARD_ART，/dev/fx 的"美术"面板可调）。
import * as THREE from 'three';
import { TABLE } from '../presentation/layout';
import { BOARD_ART } from './artStyle';
import { boardTextures, type BoardTextures } from './boardTextures';
import { shared } from './dispose';

type Uniforms = Record<string, THREE.IUniform>;

// 着色器字符串里只写 ASCII：tests/presentation-font.test.ts 把 src/scene 里字符串中的中文当成界面文字，
// 要求都在字体子集里。说明写在这里的注释里。
// lolstoneBump：世界坐标下按高度做凹凸（Mikkelsen 的 perturbNormalArb，不需要切线）
const BUMP_GLSL = /* glsl */ `
vec3 lolstoneBump(vec3 pos, vec3 n, float h, float scale) {
  vec3 dpx = dFdx(pos);
  vec3 dpy = dFdy(pos);
  float dhx = dFdx(h) * scale;
  float dhy = dFdy(h) * scale;
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad);
}
vec3 lolstoneGrade(vec3 c, float sat, float bright) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, sat) * bright;
}
`;

const GROUND_PARS = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uGrass;
uniform sampler2D uMask;
uniform vec2 uBoard;
uniform float uTime;
uniform float uEdgeDark;
uniform float uSat;
uniform float uBright;
uniform float uCaustics;
varying vec3 vLocal;
varying vec3 vWN;
${BUMP_GLSL}
`;

// 地面的表面。各段（grass、lane、bank and bed、rock、focus、caustics）：
// - grass：深绿、草绿、枯黄绿三种按大、中两级噪声混，乘两层草叶明暗；
// - lane：土路，两种土色，碎石，边缘被草叶咬碎。离土路远的像素跳过这段（省两次取样）；
// - bank and bed：河岸的湿泥和卵石，河床深色，按水深过渡；
// - rock：野区高处和陡坡是山石，横向的岩层纹，平缓处长苔；
// - focus：外圈压暗，中央（双方随从行之间）最亮；
// - caustics：河床的焦散，两层沃罗诺伊边缘反向流动取较小值，只在水下。
// 分支里取样用显式梯度（LOLSTONE_TG）：分支里的隐式求导没有定义，分支边界上会选错 mip。
const GROUND_ALBEDO = /* glsl */ `
  vec2 p = vLocal.xz;
  vec2 dpx = dFdx(p);
  vec2 dpy = dFdy(p);
  #define LOLSTONE_TG(s, k, o) textureGrad(s, p * (k) + (o), dpx * (k), dpy * (k))
  vec4 mk = texture2D(uMask, p / uBoard + 0.5);
  vec4 nA = texture2D(uNoise, p * 0.045);
  vec4 nB = texture2D(uNoise, p * 0.17 + 0.37);
  vec4 nC = texture2D(uNoise, p * 0.9 + 0.11);
  vec4 gr = texture2D(uGrass, p * 0.42);
  vec4 gr2 = texture2D(uGrass, p * 1.07 + 0.5);
  float blade = gr.r * 0.6 + gr2.r * 0.4;
  vec3 wN = normalize(vWN);
  float slope = 1.0 - clamp(wN.y, 0.0, 1.0);

  // grass
  vec3 grass = mix(vec3(0.03, 0.068, 0.024), vec3(0.062, 0.13, 0.036), smoothstep(0.3, 0.7, nA.r));
  grass = mix(grass, vec3(0.105, 0.115, 0.042), smoothstep(0.58, 0.82, nB.g) * 0.6);
  grass *= 0.45 + 1.1 * blade;
  float hgt = blade * 0.25;
  float rough = 0.9;

  // lane
  float lane = 0.0;
  float peb = 0.0;
  vec3 dirt = vec3(0.0);
  if (mk.r > 0.01) {
    float laneN = mk.r + (nB.r - 0.5) * 0.6 + (LOLSTONE_TG(uNoise, 0.38, vec2(0.7)).g - 0.5) * 0.45 + (nC.g - 0.5) * 0.22;
    lane = smoothstep(0.42, 0.6, laneN);
    lane *= 1.0 - smoothstep(0.5, 0.8, blade) * (1.0 - smoothstep(0.6, 0.85, laneN));
    dirt = mix(vec3(0.085, 0.058, 0.03), vec3(0.15, 0.108, 0.058), nC.r);
    vec4 pb = LOLSTONE_TG(uNoise, 0.75, vec2(0.3));
    peb = (1.0 - smoothstep(0.16, 0.3, pb.b)) * step(0.45, nC.g);
    dirt = mix(dirt, vec3(0.19, 0.17, 0.14) * (0.8 + 0.4 * nC.a), peb * 0.75);
    dirt *= 0.8 + 0.35 * smoothstep(0.0, 0.25, pb.a);
  }

  // bank and bed
  float wet = smoothstep(0.25, 0.7, mk.g + (nB.r - 0.5) * 0.45);
  float depth = mk.a;
  float cobble = 0.0;
  vec3 bed = vec3(0.0);
  if (wet > 0.0) {
    vec3 mud = mix(vec3(0.04, 0.032, 0.02), vec3(0.085, 0.066, 0.04), nC.r * 0.6 + nB.r * 0.4);
    vec4 cb = LOLSTONE_TG(uNoise, 0.34, vec2(0.2));
    cobble = (1.0 - smoothstep(0.14, 0.3, cb.b)) * smoothstep(0.6, 0.9, mk.g + (nB.r - 0.5) * 0.9) * smoothstep(0.55, 0.68, nB.g) * step(0.35, nC.g);
    vec3 stones = mix(vec3(0.1, 0.098, 0.088), vec3(0.2, 0.19, 0.165), nC.r) * (0.8 + 0.2 * (1.0 - cb.b));
    vec3 bank = mix(mud, stones, cobble);
    bed = mix(bank, vec3(0.012, 0.03, 0.028) + stones * 0.25 * cobble, smoothstep(0.15, 0.9, depth));
  }

  // rock
  float rockM = smoothstep(0.45, 0.75, mk.b * 0.6 + slope * 2.4 + (nB.g - 0.5) * 0.5) * (1.0 - wet);
  float strata = 0.0;
  vec3 rock = vec3(0.0);
  if (rockM > 0.0) {
    vec2 su = vec2(p.x * 0.6, vLocal.y * 2.2 + p.y * 0.15);
    strata = textureGrad(uNoise, su, dFdx(su), dFdy(su)).g;
    rock = mix(vec3(0.05, 0.047, 0.04), vec3(0.12, 0.108, 0.09), nC.r * 0.5 + strata * 0.5);
    rock = mix(rock, vec3(0.04, 0.075, 0.025), clamp(1.0 - slope * 3.0, 0.0, 1.0) * smoothstep(0.45, 0.7, nB.r) * 0.7);
  }

  vec3 col = mix(grass, dirt, lane);
  hgt = mix(hgt, peb * 0.6 + nC.a * 0.15, lane);
  rough = mix(rough, 0.95, lane);
  col = mix(col, bed, wet);
  hgt = mix(hgt, cobble * 0.5 + nC.r * 0.35 + nC.a * 0.25, wet);
  rough = mix(rough, mix(0.62, 0.45, cobble), wet);
  col = mix(col, rock, rockM);
  hgt = mix(hgt, strata * 0.8 + nC.r * 0.4, rockM);
  rough = mix(rough, 0.82, rockM);

  // focus
  vec2 q = p / (uBoard * 0.5);
  float r = length(q * vec2(0.92, 1.12));
  float focus = 1.0 - uEdgeDark * smoothstep(0.4, 1.1, r);
  diffuseColor.rgb = lolstoneGrade(col, uSat, uBright * focus);

  // caustics
  vec3 lolstoneEmit = vec3(0.0);
  if (depth > 0.04) {
    float c1 = LOLSTONE_TG(uNoise, 0.5, vec2(uTime * 0.025, uTime * 0.01)).a;
    float c2 = LOLSTONE_TG(uNoise, 0.66, vec2(-uTime * 0.018, uTime * 0.016) + 0.5).a;
    float ca = pow(1.0 - smoothstep(0.0, 0.2, min(c1, c2)), 2.0);
    lolstoneEmit = vec3(0.35, 0.6, 0.55) * ca * smoothstep(0.05, 0.6, depth) * uCaustics * 0.09;
  }

  vec3 lolstoneN = wN;
  lolstoneN = normalize(lolstoneN + vec3(gr.g * 2.0 - 1.0, 0.0, gr.b * 2.0 - 1.0) * 0.55 * (1.0 - lane) * (1.0 - wet) * (1.0 - rockM));
  lolstoneN = lolstoneBump(vLocal, lolstoneN, hgt, 0.06);
  float lolstoneRough = rough;
`;

function patchVertex(s: { vertexShader: string }): void {
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vWorldP;\nvarying vec3 vWN;')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvLocal = position;\nvWorldP = (modelMatrix * vec4(position, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * normal);',
    );
}

export type GroundMaterial = THREE.MeshStandardMaterial & { lolstone: Uniforms };

export function groundMaterial(tex: BoardTextures): GroundMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }) as GroundMaterial;
  const u: Uniforms = {
    uNoise: { value: tex.noise },
    uGrass: { value: tex.grass },
    uMask: { value: tex.mask },
    uBoard: { value: new THREE.Vector2(TABLE.width, TABLE.depth) },
    uTime: { value: 0 },
    uEdgeDark: { value: BOARD_ART.edgeDark },
    uSat: { value: BOARD_ART.saturation },
    uBright: { value: BOARD_ART.brightness },
    uCaustics: { value: BOARD_ART.caustics },
  };
  m.lolstone = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    patchVertex(s);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_PARS}`)
      .replace('#include <map_fragment>', GROUND_ALBEDO)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = lolstoneRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(lolstoneN, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += lolstoneEmit;');
  };
  m.customProgramCacheKey = () => 'lolstone-ground-2';
  return m;
}

const WATER_PARS = /* glsl */ `
uniform sampler2D uWater;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uSat;
uniform float uBright;
uniform float uGloss;
uniform float uCaustics;
varying vec3 vLocal;
varying vec3 vWN;
varying float vDepth;
${BUMP_GLSL}
`;

// 水面：两层法线反向流动，深浅按水深变；foam 是岸边一圈白沫（浅处、噪声打碎、缓慢流动）；
// caustics 是水面上的焦散亮纹
const WATER_ALBEDO = /* glsl */ `
  vec2 p = vLocal.xz;
  vec3 wa = texture2D(uWater, p * vec2(0.16, 0.28) + vec2(uTime * 0.012, uTime * 0.004)).xyz * 2.0 - 1.0;
  vec3 wb = texture2D(uWater, p * vec2(0.27, 0.41) + vec2(-uTime * 0.009, uTime * 0.007) + 0.5).xyz * 2.0 - 1.0;
  vec3 lolstoneN = normalize(vec3(wa.x + wb.x, 0.0, -(wa.y + wb.y)) * 0.22 + vec3(0.0, 1.0, 0.0));
  float deep = smoothstep(0.02, 0.3, vDepth);
  vec3 col = mix(vec3(0.03, 0.12, 0.11), vec3(0.006, 0.042, 0.07), deep);
  // foam
  float fn = texture2D(uNoise, p * 0.9 + vec2(uTime * 0.02, 0.0)).g;
  float foam = (1.0 - smoothstep(0.01, 0.06, vDepth)) * smoothstep(0.0, 0.012, vDepth) * smoothstep(0.42, 0.7, fn + texture2D(uNoise, p * 2.3 - vec2(uTime * 0.03, 0.0)).r * 0.3);
  col = mix(col, vec3(0.3, 0.36, 0.35), foam * 0.4);
  diffuseColor.rgb = lolstoneGrade(col, uSat, uBright);
  diffuseColor.a = smoothstep(0.0, 0.05, vDepth) * mix(0.3, 0.88, deep) + foam * 0.35;
  float lolstoneRough = 0.08 + foam * 0.5;
  // caustics
  float c1 = texture2D(uNoise, p * 0.42 + vec2(uTime * 0.02, uTime * 0.008)).a;
  float c2 = texture2D(uNoise, p * 0.55 + vec2(-uTime * 0.015, uTime * 0.013) + 0.5).a;
  float lolstoneCa = pow(1.0 - smoothstep(0.0, 0.18, min(c1, c2)), 2.0) * (0.4 + 0.6 * deep);
`;

// 太阳在波纹上的碎光、掠射角的天光、焦散，加在自发光上（不进泛光）
const WATER_SPEC = /* glsl */ `
  {
    vec3 V = normalize(vViewPosition);
    #if NUM_DIR_LIGHTS > 0
      vec3 L = directionalLights[0].direction;
      float spark = pow(max(dot(reflect(-V, normal), L), 0.0), 220.0);
      totalEmissiveRadiance += directionalLights[0].color * spark * 0.5 * uGloss;
    #endif
    float fres = pow(1.0 - max(dot(normal, V), 0.0), 2.0);
    totalEmissiveRadiance += vec3(0.05, 0.11, 0.13) * fres * uGloss;
    totalEmissiveRadiance += vec3(0.25, 0.5, 0.48) * lolstoneCa * uCaustics * 0.06;
  }
`;

export type WaterMaterial = THREE.MeshStandardMaterial & { lolstone: Uniforms };

export function waterMaterial(tex: BoardTextures): WaterMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.07, metalness: 0, transparent: true }) as WaterMaterial;
  const u: Uniforms = {
    uWater: { value: tex.water },
    uNoise: { value: tex.noise },
    uTime: { value: 0 },
    uSat: { value: BOARD_ART.saturation },
    uBright: { value: BOARD_ART.brightness },
    uGloss: { value: BOARD_ART.waterGloss },
    uCaustics: { value: BOARD_ART.caustics },
  };
  m.lolstone = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    patchVertex(s);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_PARS}`)
      .replace('#include <map_fragment>', WATER_ALBEDO)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = lolstoneRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(lolstoneN, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + WATER_SPEC);
  };
  m.customProgramCacheKey = () => 'lolstone-water-2';
  return m;
}

// 深色石材（台面外框、枢纽石台、石墩）：stone 纹理按世界坐标投影取明暗，接缝不随物件大小拉伸
const STONE_PARS = /* glsl */ `
uniform sampler2D uStone;
uniform float uScale;
varying vec3 vWorldP;
varying vec3 vWN;
${BUMP_GLSL}
`;

// 只取朝向最主要的那一面投影（一次取样）：外框、石台都是平面和直立的侧面，混三面看不出区别
const STONE_ALBEDO = /* glsl */ `
  vec3 wN = normalize(vWN);
  vec3 bw = pow(abs(wN), vec3(4.0));
  bw /= bw.x + bw.y + bw.z;
  vec3 wp = vWorldP * uScale;
  vec2 suv = bw.y > 0.5 ? wp.xz : (bw.x > bw.z ? wp.zy : wp.xy);
  float sh = textureGrad(uStone, suv, dFdx(suv), dFdy(suv)).r;
  diffuseColor.rgb *= 0.7 + 0.45 * sh;
  float lolstoneH = sh;
`;

export function stoneMaterial(color: number, scale = 0.45, roughness = 0.82): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uStone = { value: boardTextures().stone };
    s.uniforms.uScale = { value: scale };
    patchVertex(s);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${STONE_PARS}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + STONE_ALBEDO)
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(lolstoneBump(vWorldP, normalize(vWN), lolstoneH, 0.05), 0.0)).xyz);',
      );
  };
  m.customProgramCacheKey = () => `lolstone-stone-${scale}`;
  return shared(m);
}
