// 冻结的冰壳（m4-storyboard E17，用户 2026-10-20 反馈"一个方砖有点单调"后重做）。挂在随从的 body 上，四层：
// - 冰棱：从底座四周和底座上沿长出的十几根多面体冰晶，粗细、高矮、倾角都不同，远侧几根高出头像；近侧只有矮的，
//   而且避开两个徽章。按随从的实例 id 生成，所以一排冻住的随从各不一样。所有冰棱合成一个几何体（一次绘制）。
//   材质是半透明的物理材质（清漆、平面着色、反射舞台的环境贴图，高光随角度变），着色器里再加：菲涅尔亮边、
//   按位置取的细裂纹和气泡纹理、偶尔闪过的反光；生长、碎裂、消融都在顶点着色器里按每根冰棱的属性算，不用补间几百个物件。
// - 冰面：盖在头像上的一层不规则冰壳，边缘参差。片元着色器里把头像按晶格偏移着重采一遍（假折射），蒙一层冰蓝，
//   叠上裂纹和气泡；结冰时从边缘往里长，碎裂时按晶格一块块消失。
// - 冷雾：贴地一圈缓慢流动的淡雾（加色，噪声贴图滚动）。
// - 雪点：几粒缓慢飘落的小雪点（点精灵，位置在着色器里按时间算）。
// 雾和雪不占粒子池（spec 5.10 的 2000 上限）。显示与否按显示局面（MinionView.update → setFrozen），
// 进入和解冻的过程由动画模块调 grow / flash / crack / shatter。
import gsap from 'gsap';
import * as THREE from 'three';
import { shared } from '../../scene/dispose';
import { MINION_HEIGHT, MINION_SIZE } from '../layout';

export const ICE = {
  spikes: 15, // 冰棱根数
  opacity: 0.32, // 冰棱本身的不透明度（边缘按菲涅尔再加）
  rim: 0.55, // 菲涅尔亮边强度
  glow: 0.08, // 冰芯的淡蓝自发光
  detail: 0.22, // 裂纹和气泡的亮度
  glint: 1.6, // 反光闪过时的亮度
  glintRate: 0.55, // 反光的频率（越大越频繁）
  coatOpacity: 0.86, // 头像上冰面的不透明度
  refract: 0.05, // 冰面假折射的偏移量（头像 uv）
  mist: 0.1, // 冷雾的亮度
  snow: 7, // 雪点数（构造时定，改了要新冻的随从才生效）
};

// ---------- 共用贴图（程序生成，一局一次，多局共用） ----------

// 细节贴图 256²，可平铺：R、G 是晶格（Voronoi 胞）各自的随机偏移，用来做假折射和碎裂顺序；B 是裂纹（胞边缘的一部分）；
// A 是气泡（小圆斑带亮边）
function makeDetail(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  let s = 1234567;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const P = 30;
  const px: number[] = [];
  const py: number[] = [];
  const cr: number[] = [];
  const cg: number[] = [];
  const keep: boolean[] = [];
  for (let i = 0; i < P; i++) {
    px.push(rnd() * N);
    py.push(rnd() * N);
    cr.push(rnd());
    cg.push(rnd());
    keep.push(rnd() < 0.7);
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let i1 = 0;
      let i2 = 0;
      for (let i = 0; i < P; i++) {
        let dx = Math.abs(x - px[i]);
        let dy = Math.abs(y - py[i]);
        if (dx > N / 2) dx = N - dx;
        if (dy > N / 2) dy = N - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          i2 = i1;
          d1 = d;
          i1 = i;
        } else if (d < d2) {
          d2 = d;
          i2 = i;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const crack = keep[i1] && keep[i2] ? Math.max(0, 1 - edge / 1.6) : 0;
      const o = (y * N + x) * 4;
      data[o] = Math.round(cr[i1] * 255);
      data[o + 1] = Math.round(cg[i1] * 255);
      data[o + 2] = Math.round(crack * 255);
    }
  }
  // 气泡
  for (let b = 0; b < 70; b++) {
    const cx = rnd() * N;
    const cy = rnd() * N;
    const r = 1.2 + rnd() * 3.2;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1.15) continue;
        const v = d > 0.75 ? 1 - Math.abs(d - 0.92) / 0.23 : 0.25; // 亮边、淡芯
        const o = ((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4 + 3;
        data[o] = Math.max(data[o], Math.round(Math.max(0, v) * 255));
      }
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return shared(t);
}

// 平滑噪声 64²，可平铺（冷雾）
function makeNoise(): THREE.DataTexture {
  const N = 64;
  const G = 8;
  let s = 7654321;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const grid: number[] = [];
  for (let i = 0; i < G * G; i++) grid.push(rnd());
  const at = (gx: number, gy: number) => grid[(((gy % G) + G) % G) * G + (((gx % G) + G) % G)];
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * G;
      const fy = (y / N) * G;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const v = (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
      const o = (y * N + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = data[o + 3] = Math.round(v * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return shared(t);
}

let detailTex: THREE.DataTexture | null = null;
let noiseTex: THREE.DataTexture | null = null;
const detail = () => (detailTex ??= makeDetail());
const noise = () => (noiseTex ??= makeNoise());

// 所有冰壳共用的时间（全局时间线的时间：跟着快进、慢放，手动推时钟录帧时也对）和 ICE 里的参数，每帧从 ICE 抄一次，
// 调试台改 ICE 马上生效
const TIME = { value: 0 };
const U = {
  rim: { value: ICE.rim },
  det: { value: ICE.detail },
  glint: { value: ICE.glint },
  rate: { value: ICE.glintRate },
  coat: { value: ICE.coatOpacity },
  refract: { value: ICE.refract },
  mist: { value: ICE.mist },
};
function refresh(): void {
  TIME.value = gsap.globalTimeline.time();
  U.rim.value = ICE.rim;
  U.det.value = ICE.detail;
  U.glint.value = ICE.glint;
  U.rate.value = ICE.glintRate;
  U.coat.value = ICE.coatOpacity;
  U.refract.value = ICE.refract;
  U.mist.value = ICE.mist;
}
let reflections: THREE.Texture | null = null;

// 冰棱反射的环境贴图（舞台的 reflections），对局场景建好时设一次
export function useIceReflections(env: THREE.Texture): void {
  reflections = env;
}

// ---------- 冰棱几何体 ----------

type Rand = () => number;
function seeded(seed: number): Rand {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const HALF = MINION_SIZE / 2;

// 一根冰棱：k 棱柱身加尖顶，根部略粗。返回三角形顶点（非索引，平面着色）
function spike(out: number[], k: number, r: number, h: number, tip: number, twist: number): void {
  const ring = (y: number, rr: number) => Array.from({ length: k }, (_, i) => {
    const a = twist + (i / k) * Math.PI * 2;
    const jag = 0.8 + ((i * 7919) % 5) / 10; // 截面不规则
    return [Math.cos(a) * rr * jag, y, Math.sin(a) * rr * jag];
  });
  const b = ring(-0.02, r);
  const m = ring(h, r * 0.82);
  const top = [0, h + tip, 0];
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    out.push(...b[i], ...m[i], ...b[j], ...b[j], ...m[i], ...m[j]);
    out.push(...m[i], ...top, ...m[j]);
  }
}

// 一个随从的全部冰棱。属性：aRoot 根部位置、aGrow 开始生长的时刻（0 到 1）、aDir 碎裂时飞出的方向、aSeed 随机数
function crystalGeometry(seed: number, count: number): THREE.BufferGeometry {
  const rnd = seeded(seed);
  const pos: number[] = [];
  const root: number[] = [];
  const grow: number[] = [];
  const dir: number[] = [];
  const seeds: number[] = [];
  const placed: { x: number; z: number; y: number; ang: number; size: 'tall' | 'mid' | 'low' }[] = [];
  // 远侧（画面上方）：高的冰刺；左右两侧：中等；近侧：矮的，避开两个徽章（底座近侧的两个角）
  for (let i = 0; i < count; i++) {
    const side = i < count * 0.4 ? 'far' : i < count * 0.8 ? (i % 2 ? 'left' : 'right') : 'near';
    let x = 0;
    let z = 0;
    if (side === 'far') {
      x = (rnd() * 2 - 1) * (HALF + 0.05);
      z = -HALF - 0.02 + rnd() * 0.22;
    } else if (side === 'left' || side === 'right') {
      x = (side === 'left' ? -1 : 1) * (HALF - 0.05 + rnd() * 0.15);
      z = -HALF + rnd() * (MINION_SIZE * 0.6);
    } else {
      x = (rnd() * 2 - 1) * 0.18;
      z = HALF - 0.06 + rnd() * 0.12;
    }
    const onBase = Math.abs(x) < HALF - 0.08 && Math.abs(z) < HALF - 0.08;
    const y = onBase ? MINION_HEIGHT : 0;
    const size = side === 'far' ? (rnd() < 0.45 ? 'tall' : 'mid') : side === 'near' ? 'low' : rnd() < 0.25 ? 'tall' : rnd() < 0.6 ? 'mid' : 'low';
    placed.push({ x, z, y, ang: Math.atan2(z, x), size });
  }
  // 生长顺序：从一侧开始绕底座一圈，相邻的接着长
  const start = rnd() * Math.PI * 2;
  const order = placed.map((p, i) => ({ i, a: (((p.ang - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) })).sort((p, q) => p.a - q.a);
  order.forEach(({ i }, rank) => {
    const p = placed[i];
    const k = 5 + Math.floor(rnd() * 2);
    const r = p.size === 'tall' ? 0.09 + rnd() * 0.05 : p.size === 'mid' ? 0.07 + rnd() * 0.05 : 0.05 + rnd() * 0.04;
    const h = p.size === 'tall' ? 0.6 + rnd() * 0.4 : p.size === 'mid' ? 0.32 + rnd() * 0.3 : 0.1 + rnd() * 0.14;
    const local: number[] = [];
    spike(local, k, r, h, r * (1.6 + rnd() * 1.4), rnd() * Math.PI);
    // 向外倾：远离底座中心，越靠角越斜
    const out = new THREE.Vector3(p.x, 0, p.z).normalize();
    const lean = 0.12 + rnd() * 0.45;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(out.z, 0, -out.x), lean);
    const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    q.multiply(twist);
    const v = new THREE.Vector3();
    const g = (rank / Math.max(1, placed.length - 1)) * 0.6;
    const sd = rnd();
    for (let j = 0; j < local.length; j += 3) {
      v.set(local[j], local[j + 1], local[j + 2]).applyQuaternion(q);
      pos.push(p.x + v.x, p.y + v.y, p.z + v.z);
      root.push(p.x, p.y, p.z);
      grow.push(g);
      dir.push(out.x, 0, out.z);
      seeds.push(sd);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 3));
  geo.setAttribute('aGrow', new THREE.Float32BufferAttribute(grow, 1));
  geo.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// 头像上的冰面：边缘参差的多边形，比头像略大一点
function coatGeometry(seed: number): THREE.ShapeGeometry {
  const rnd = seeded(seed + 17);
  const R = MINION_SIZE / 2 - 0.08;
  const shape = new THREE.Shape();
  const n = 28;
  for (let i = 0; i < n; i++) {
    // 方形轮廓上取点，再往里外抖一点
    const tt = (i / n) * 4;
    const e = Math.floor(tt);
    const f = tt - e;
    const corners = [
      [-R, -R],
      [R, -R],
      [R, R],
      [-R, R],
    ];
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    let x = a[0] + (b[0] - a[0]) * f;
    let y = a[1] + (b[1] - a[1]) * f;
    const j = (rnd() - 0.5) * 0.14;
    const len = Math.hypot(x, y);
    x += (x / len) * j;
    y += (y / len) * j;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

// ---------- 材质 ----------

type IceUniforms = { uGrow: { value: number }; uShatter: { value: number }; uCrack: { value: number }; uFlash: { value: number } };

function crystalMaterial(u: IceUniforms): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x5f9fd0,
    emissive: 0x4fb0f0,
    emissiveIntensity: ICE.glow,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    flatShading: true,
    transparent: true,
    opacity: ICE.opacity,
    depthWrite: false,
    envMap: reflections,
    envMapIntensity: 0.55,
  });
  // 顶点着色器：生长是每根冰棱从根部按自己的开始时刻（aGrow）放大；碎裂是向外、向上飞出，受重力落到台面，落地后缩小消融。
  // 着色器字符串里不写中文注释：字体子集扫描会把字符串里的中文当成界面文字
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uTime: TIME, uDetail: { value: detail() }, uRim: U.rim, uDet: U.det, uGlint: U.glint, uRate: U.rate });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRoot; attribute float aGrow; attribute vec3 aDir; attribute float aSeed;
        uniform float uGrow; uniform float uShatter;
        varying vec3 vIcePos; varying float vSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float gk = clamp((uGrow - aGrow) / 0.4, 0.0, 1.0);
        gk = 1.0 - pow(1.0 - gk, 3.0);
        transformed = aRoot + (transformed - aRoot) * gk;
        if (uShatter > 0.0) {
          float t = uShatter * 0.55;
          vec3 v = aDir * (1.4 + aSeed * 1.6) + vec3(0.0, 1.6 + aSeed * 1.4, 0.0);
          vec3 off = v * t + vec3(0.0, -9.0 * t * t, 0.0);
          float melt = clamp((uShatter - 0.45) / 0.55, 0.0, 1.0);
          vec3 c = aRoot + (transformed - aRoot) * (1.0 - melt) * 0.7;
          transformed = c + off;
          transformed.y = max(transformed.y, 0.005);
        }
        vIcePos = transformed; vSeed = aSeed;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform float uCrack; uniform float uFlash; uniform sampler2D uDetail;
        uniform float uRim; uniform float uDet; uniform float uGlint; uniform float uRate;
        varying vec3 vIcePos; varying float vSeed;
        float iceRim;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        iceRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
        vec4 det = texture2D(uDetail, vIcePos.xz * 1.6 + vec2(vIcePos.y * 0.9, vSeed));
        float glint = pow(max(0.0, sin(uTime * uRate * 6.2832 * (0.6 + vSeed) + vSeed * 40.0)), 90.0);
        totalEmissiveRadiance += vec3(0.55, 0.82, 1.0) * iceRim * uRim
          + vec3(0.7, 0.9, 1.0) * (det.b * (uDet + uCrack * 2.2) + det.a * uDet * 0.8)
          + vec3(1.0) * (glint * uGlint + uFlash * 1.4);`,
      )
      .replace('#include <opaque_fragment>', `diffuseColor.a = clamp(diffuseColor.a + iceRim * 0.35 + uFlash * 0.3, 0.0, 1.0);\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'lolstone-ice-crystal-1';
  return m;
}

function coatMaterial(u: IceUniforms, portrait: THREE.Texture | null, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...u,
      uTime: TIME,
      uDetail: { value: detail() },
      uPortrait: { value: portrait },
      uSeed: { value: new THREE.Vector2((seed % 97) / 97, (seed % 53) / 53) },
      uOpacity: U.coat,
      uRefract: U.refract,
      uCoat: { value: 1 },
    },
    vertexShader: `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    // vP 是冰面的平面坐标（转平之前）：x 向右，y 向远处。头像 uv 由它算出来。
    // 斜着扫过的一道反光：每 4.5 秒左右一次，0.75 秒扫过去（扫得慢了会像一道固定的白条）。
    // 结冰时从边缘往里长；碎裂时按晶格一块块消失
    fragmentShader: `
      uniform float uTime; uniform float uCrack; uniform float uFlash; uniform float uShatter; uniform float uCoat;
      uniform float uOpacity; uniform float uRefract;
      uniform sampler2D uDetail; uniform sampler2D uPortrait; uniform vec2 uSeed;
      varying vec2 vP;
      void main() {
        float art = ${(MINION_SIZE - 0.2).toFixed(3)};
        vec2 uv = vec2(vP.x / art + 0.5, vP.y / art + 0.5);
        vec4 d = texture2D(uDetail, uv * 1.25 + uSeed);
        vec2 off = (d.rg - 0.5) * uRefract;
        vec3 col = texture2D(uPortrait, clamp(uv + off, 0.0, 1.0)).rgb;
        float lum = dot(col, vec3(0.3, 0.59, 0.11));
        col = mix(col, vec3(lum) * vec3(0.8, 0.95, 1.12), 0.35) * vec3(0.85, 0.96, 1.08) + vec3(0.02, 0.05, 0.08);
        float edge = max(abs(vP.x), abs(vP.y)) / ${(MINION_SIZE / 2 - 0.08).toFixed(3)};
        col = mix(col, vec3(0.62, 0.8, 0.95), smoothstep(0.65, 1.05, edge) * 0.45);
        col += vec3(0.55, 0.8, 1.0) * d.b * (0.25 + uCrack * 2.4);
        col += vec3(0.5, 0.72, 0.9) * d.a * 0.3;
        float sw = fract(uTime / 4.5 + uSeed.x) * 12.0 - 1.0;
        float band = exp(-pow((uv.x + uv.y) - sw, 2.0) * 160.0);
        col += vec3(0.9, 0.97, 1.0) * band * 0.4 + vec3(1.0) * uFlash * 0.6;
        float grow = smoothstep(0.0, 0.1, edge + (d.r - 0.5) * 0.35 - (1.0 - uCoat * 1.35));
        float cell = fract(d.r * 13.7 + d.g * 7.3);
        float gone = step(cell, uShatter * 1.6);
        gl_FragColor = vec4(col, uOpacity * grow * (1.0 - gone));
      }`,
    transparent: true,
    depthWrite: false,
  });
}

// 贴地冷雾：圆环上滚动的噪声
const mistGeo = shared(new THREE.RingGeometry(0.55, 1.3, 40, 1));
function mistMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uNoise: { value: noise() }, uSeed: { value: (seed % 101) / 101 }, uMist: U.mist, uFade: { value: 1 } },
    vertexShader: `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform sampler2D uNoise; uniform float uSeed; uniform float uMist; uniform float uFade;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float a = atan(vP.y, vP.x) / 6.2832;
        float n = texture2D(uNoise, vec2(a * 3.0 + uTime * 0.03 + uSeed, r * 0.8 - uTime * 0.05)).r;
        float n2 = texture2D(uNoise, vec2(a * 5.0 - uTime * 0.02, r * 1.3 + uSeed)).r;
        float fall = smoothstep(0.55, 0.8, r) * (1.0 - smoothstep(0.95, 1.3, r));
        float v = smoothstep(0.35, 0.85, n * 0.65 + n2 * 0.5) * fall * uMist * uFade;
        gl_FragColor = vec4(vec3(0.7, 0.86, 1.0) * v, 0.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

// 雪点：每粒一个随机数，位置在着色器里按时间算（在底座上方转着落下）
function snowGeometry(n: number, seed: number): THREE.BufferGeometry {
  const rnd = seeded(seed + 99);
  const pos: number[] = [];
  for (let i = 0; i < n; i++) pos.push(rnd(), rnd(), rnd());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1.5);
  return g;
}
const SNOW_PX = { value: 1 };
function snowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uPx: SNOW_PX, uFade: { value: 1 } },
    vertexShader: `
      uniform float uTime; uniform float uPx;
      varying float vA;
      void main() {
        float ph = fract(uTime * (0.09 + position.z * 0.06) + position.x);
        float ang = position.y * 6.2832 + uTime * 0.4;
        float rad = 0.35 + position.z * 0.55;
        vec3 p = vec3(cos(ang) * rad, 1.25 - ph * 1.25, sin(ang) * rad);
        vA = smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.75, 1.0, ph));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uPx * 0.03 / -mv.z * projectionMatrix[1][1];
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uFade;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.3, 1.0, d)) * vA * uFade * 0.8;
        gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a, 0.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

// ---------- 冰壳 ----------

export class IceShell extends THREE.Group {
  private readonly u: IceUniforms = { uGrow: { value: 1 }, uShatter: { value: 0 }, uCrack: { value: 0 }, uFlash: { value: 0 } };
  private readonly crystals: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private readonly coat: THREE.Mesh<THREE.ShapeGeometry, THREE.ShaderMaterial>;
  private readonly mist: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private thawing = false;
  private frozen = false;

  constructor(seed: number, portrait: THREE.Texture | null) {
    super();
    this.crystals = new THREE.Mesh(crystalGeometry(seed, ICE.spikes), crystalMaterial(this.u));
    this.crystals.renderOrder = 3;
    this.crystals.castShadow = false;
    this.coat = new THREE.Mesh(coatGeometry(seed), coatMaterial(this.u, portrait, seed));
    this.coat.rotation.x = -Math.PI / 2;
    this.coat.position.y = MINION_HEIGHT + 0.012;
    this.coat.renderOrder = 1;
    this.mist = new THREE.Mesh(mistGeo, mistMaterial(seed));
    this.mist.rotation.x = -Math.PI / 2;
    this.mist.position.y = 0.012;
    this.snow = new THREE.Points(snowGeometry(ICE.snow, seed), snowMaterial());
    this.snow.onBeforeRender = (r) => {
      SNOW_PX.value = r.getDrawingBufferSize(SIZE).y;
    };
    this.add(this.coat, this.mist, this.crystals, this.snow);
    this.visible = false;
    // 时间和参数每帧更新：挂在冰棱上（冻住的随从都会画冰棱）
    this.crystals.onBeforeRender = () => {
      refresh();
      const mat = this.crystals.material;
      mat.opacity = ICE.opacity;
      mat.emissiveIntensity = ICE.glow;
    };
  }

  // 头像换了（配图稍后加载好）时跟着换
  setPortrait(t: THREE.Texture | null): void {
    this.coat.material.uniforms.uPortrait.value = t;
  }

  // 按显示局面设：冻住就整块显示，解冻正在播时不打断
  setFrozen(on: boolean): void {
    if (on === this.frozen && !(on && this.thawing)) return;
    this.frozen = on;
    if (on) {
      this.killTweens();
      this.thawing = false;
      this.reset();
      this.visible = true;
    } else if (!this.thawing) {
      this.visible = false;
    }
  }

  private reset(): void {
    Object.assign(this.u.uGrow, { value: 1 });
    Object.assign(this.u.uShatter, { value: 0 });
    Object.assign(this.u.uCrack, { value: 0 });
    Object.assign(this.u.uFlash, { value: 0 });
    this.coat.material.uniforms.uCoat.value = 1;
    this.mist.material.uniforms.uFade.value = 1;
    this.snow.material.uniforms.uFade.value = 1;
  }

  private killTweens(): void {
    gsap.killTweensOf([this.u.uGrow, this.u.uShatter, this.u.uCrack, this.u.uFlash, this.coat.material.uniforms.uCoat, this.mist.material.uniforms.uFade, this.snow.material.uniforms.uFade]);
  }

  // 结冰：冰棱按各自的顺序一根根长出来，冰面从边缘往里长，雾和雪淡入
  grow(duration: number): gsap.core.Timeline {
    this.killTweens();
    this.visible = true;
    const t = gsap.timeline();
    t.fromTo(this.u.uGrow, { value: 0 }, { value: 1, duration, ease: 'none' }, 0);
    t.fromTo(this.coat.material.uniforms.uCoat, { value: 0 }, { value: 1, duration: duration * 0.85, ease: 'power2.out' }, duration * 0.15);
    t.fromTo(this.mist.material.uniforms.uFade, { value: 0 }, { value: 1, duration: duration * 1.5, ease: 'power1.out' }, 0);
    t.fromTo(this.snow.material.uniforms.uFade, { value: 0 }, { value: 1, duration: duration * 2, ease: 'power1.out' }, 0);
    return t;
  }

  // 冰晶闪光：整个冰壳亮一下
  flash(duration: number): gsap.core.Tween {
    return gsap.fromTo(this.u.uFlash, { value: 1 }, { value: 0, duration, ease: 'power2.out' });
  }

  // 解冻第一段：裂纹亮起来
  crack(duration: number): gsap.core.Tween {
    this.thawing = true;
    return gsap.fromTo(this.u.uCrack, { value: 0 }, { value: 1, duration, ease: 'power2.in' });
  }

  // 解冻第二段：冰棱飞散落地消融，冰面按晶格碎掉，雾和雪淡出。播完藏起来（显示局面这时已经是解冻）
  shatter(duration: number): gsap.core.Timeline {
    this.thawing = true;
    const t = gsap.timeline({
      onComplete: () => {
        this.thawing = false;
        if (!this.frozen) this.visible = false;
        this.reset();
      },
    });
    t.fromTo(this.u.uShatter, { value: 0 }, { value: 1, duration, ease: 'none' }, 0);
    t.to(this.u.uFlash, { value: 0.5, duration: 0.04 }, 0);
    t.to(this.u.uFlash, { value: 0, duration: 0.2, ease: 'power2.out' }, 0.04);
    t.to(this.mist.material.uniforms.uFade, { value: 0, duration: duration * 0.6 }, 0);
    t.to(this.snow.material.uniforms.uFade, { value: 0, duration: duration * 0.5 }, 0);
    return t;
  }
}

const SIZE = new THREE.Vector2();

// ---------- 结冰时台面上扩散的一圈霜纹 ----------

// 霜纹贴图：从中心往外的分叉冰花（canvas，生成一次）
let frostTex: THREE.CanvasTexture | null = null;
function frostTexture(): THREE.CanvasTexture {
  if (frostTex) return frostTex;
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const rnd = seeded(4242);
  g.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.cos(a) * len;
    const y2 = y + Math.sin(a) * len;
    g.strokeStyle = `rgba(225,245,255,${0.35 + 0.5 * (w / 4)})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x2, y2);
    g.stroke();
    if (depth <= 0 || len < 6) return;
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const t = 0.35 + rnd() * 0.6;
      const bx = x + (x2 - x) * t;
      const by = y + (y2 - y) * t;
      const side = i % 2 ? 1 : -1;
      branch(bx, by, a + side * (0.5 + rnd() * 0.5), len * (0.35 + rnd() * 0.25), w * 0.6, depth - 1);
    }
    branch(x2, y2, a + (rnd() - 0.5) * 0.4, len * 0.6, w * 0.8, depth - 1);
  };
  // 中间留空（底座挡着），冰花从底座边缘往外长
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.2;
    branch(N / 2 + Math.cos(a) * N * 0.16, N / 2 + Math.sin(a) * N * 0.16, a + (rnd() - 0.5) * 0.4, N * (0.1 + rnd() * 0.08), 3.5, 3);
  }
  frostTex = shared(new THREE.CanvasTexture(c));
  frostTex.colorSpace = THREE.SRGBColorSpace;
  return frostTex;
}

const frostGeo = shared(new THREE.PlaneGeometry(1, 1));

// 在 at（台面上的点）扩散一圈霜纹：放大 0.4 → radius 倍，亮起再淡出。播完自己移除
export function frostRing(layer: THREE.Object3D, at: { x: number; z: number }, radius: number, duration: number): gsap.core.Timeline {
  const mat = new THREE.MeshBasicMaterial({ map: frostTexture(), color: 0xcfeeff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const m = new THREE.Mesh(frostGeo, mat);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.random() * Math.PI * 2;
  m.position.set(at.x, 0.008, at.z);
  m.renderOrder = 1;
  const st = { k: 0 };
  const apply = () => {
    m.scale.setScalar(radius * 2 * (0.4 + 0.6 * st.k));
    mat.opacity = Math.min(1, st.k * 3) * (1 - Math.max(0, (st.k - 0.5) / 0.5));
  };
  const t = gsap.timeline({ onComplete: () => (m.removeFromParent(), mat.dispose()), onInterrupt: () => (m.removeFromParent(), mat.dispose()) });
  t.call(() => {
    layer.add(m);
    apply();
  });
  t.to(st, { k: 1, duration, ease: 'power2.out', onUpdate: apply });
  return t;
}

// 冰壳的预热：环境贴图和程序生成的贴图
export function warmIce(renderer: THREE.WebGLRenderer, env: THREE.Texture): void {
  useIceReflections(env);
  // 贴图先传到显卡：不然第一个冻住的随从那一帧要多花十几毫秒。着色器由 fx/warm.ts 的彩排编译（彩排里有一个冻住的随从）
  renderer.initTexture(detail());
  renderer.initTexture(noise());
  renderer.initTexture(frostTexture());
}
