// 棋盘用的程序纹理（M4 美术）：页面里第一次用到时在 CPU 上生成一次，之后所有对局共用（shared），不每帧重画。
// - noise：256² 可平铺，R 低频 fbm、G 中频 fbm、B 沃罗诺伊 F1（碎石、卵石的形状）、A 沃罗诺伊边缘 F2 − F1（焦散、裂纹）；
// - grass：512² 可平铺的草叶，R 是草叶明暗，G、B 是草叶法线的 x、z；
// - mask：按棋盘大小的遮罩，每单位 16 像素，R 土路（随从行）、G 湿泥（河岸）、B 山石（野区高处）、A 水深；
//   由 terrain.ts 的高度场算出来，着色器再用噪声把边缘打碎；
// - stone：深色石材的明暗和法线，台面外框、枢纽石台、石墩用；
// - water：水面法线。
// 生成全部纹理在 M4 Pro 上约 60ms（加载时一次）。
import * as THREE from 'three';
import { boardSlot, TABLE } from '../presentation/layout';
import { riverCenter, terrainHeight, WATER_LEVEL } from './terrain';
import { shared } from './dispose';

const mod = (a: number, n: number) => ((a % n) + n) % n;

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 周期为 P 的值噪声（x、z 以格为单位），输出 0 到 1
function pnoise(x: number, z: number, P: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(mod(ix, P), mod(iz, P), seed);
  const b = hash(mod(ix + 1, P), mod(iz, P), seed);
  const c = hash(mod(ix, P), mod(iz + 1, P), seed);
  const d = hash(mod(ix + 1, P), mod(iz + 1, P), seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// 可平铺的 fbm：u、v 是 0 到 1 的纹理坐标
function pfbm(u: number, v: number, P: number, octaves: number, seed: number): number {
  let s = 0;
  let w = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const p = P << o;
    s += pnoise(u * p, v * p, p, seed + o * 17) * w;
    total += w;
    w *= 0.5;
  }
  return s / total;
}

// 可平铺的沃罗诺伊：C×C 格，每格一个抖动点。返回 [F1, F2 − F1]，以格宽为单位
function pvoronoi(u: number, v: number, C: number, seed: number): [number, number] {
  const x = u * C;
  const z = v * C;
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let f1 = 9;
  let f2 = 9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cz = iz + dz;
      const px = cx + 0.15 + 0.7 * hash(mod(cx, C), mod(cz, C), seed);
      const pz = cz + 0.15 + 0.7 * hash(mod(cx, C), mod(cz, C), seed + 1);
      const d = Math.hypot(x - px, z - pz);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2 - f1];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function dataTexture(data: Uint8Array, w: number, h: number, repeat: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return shared(t);
}

// 高度图（可平铺）转法线：返回每像素 [nx, nz]，-1 到 1
function heightToNormal(hgt: Float32Array, N: number, strength: number): Float32Array {
  const out = new Float32Array(N * N * 2);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = hgt[y * N + mod(x + 1, N)]! - hgt[y * N + mod(x - 1, N)]!;
      const dz = hgt[mod(y + 1, N) * N + x]! - hgt[mod(y - 1, N) * N + x]!;
      const nx = -dx * strength;
      const nz = -dz * strength;
      const l = Math.hypot(nx, nz, 1);
      out[(y * N + x) * 2] = nx / l;
      out[(y * N + x) * 2 + 1] = nz / l;
    }
  }
  return out;
}

export type BoardTextures = {
  noise: THREE.DataTexture;
  grass: THREE.DataTexture;
  mask: THREE.DataTexture;
  stone: THREE.DataTexture;
  water: THREE.DataTexture;
};

function noiseTexture(): THREE.DataTexture {
  const N = 256;
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const [f1, edge] = pvoronoi(u, v, 14, 91);
      const i = (y * N + x) * 4;
      d[i] = pfbm(u, v, 4, 4, 3) * 255;
      d[i + 1] = pfbm(u, v, 8, 3, 41) * 255;
      d[i + 2] = clamp01(f1 / 0.9) * 255;
      d[i + 3] = clamp01(edge / 0.6) * 255;
    }
  }
  return dataTexture(d, N, N, true);
}

// 草叶：俯视时是一根根朝向各异、两头尖的短线。先在 canvas 上画明暗（越亮越高），再从明暗求法线
function grassTexture(): THREE.DataTexture {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgb(70,70,70)';
  g.fillRect(0, 0, N, N);
  g.lineCap = 'round';
  let s = 7;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let k = 0; k < 5200; k++) {
    const x = rnd() * N;
    const y = rnd() * N;
    // 大多数草叶朝镜头的反方向倒（-v），带一些散开
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
    const len = 7 + rnd() * 14;
    const v = 60 + rnd() * 195;
    const w = 1.2 + rnd() * 1.8;
    for (const ox of [-N, 0, N]) {
      for (const oy of [-N, 0, N]) {
        const bx = x + ox;
        const by = y + oy;
        if (bx < -30 || bx > N + 30 || by < -30 || by > N + 30) continue;
        const grad = g.createLinearGradient(bx, by, bx + Math.cos(a) * len, by + Math.sin(a) * len);
        grad.addColorStop(0, `rgb(${v * 0.35},${v * 0.35},${v * 0.35})`);
        grad.addColorStop(1, `rgb(${v},${v},${v})`);
        g.strokeStyle = grad;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(bx, by);
        g.quadraticCurveTo(bx + Math.cos(a + 0.4) * len * 0.5, by + Math.sin(a + 0.4) * len * 0.5, bx + Math.cos(a) * len, by + Math.sin(a) * len);
        g.stroke();
      }
    }
  }
  const px = g.getImageData(0, 0, N, N).data;
  const hgt = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) hgt[i] = px[i * 4]! / 255;
  const nrm = heightToNormal(hgt, N, 3.5);
  const d = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    d[i * 4] = px[i * 4]!;
    d[i * 4 + 1] = (nrm[i * 2]! * 0.5 + 0.5) * 255;
    d[i * 4 + 2] = (nrm[i * 2 + 1]! * 0.5 + 0.5) * 255;
    d[i * 4 + 3] = 255;
  }
  return dataTexture(d, N, N, true);
}

const PPU = 16; // 遮罩每单位多少像素
export const MASK_SIZE = { w: Math.round(TABLE.width * PPU), h: Math.round(TABLE.depth * PPU) };

// 随从行的土路：行中心 ±0.9 内是路面，两端圆头收在 |x| = 7.6
export function laneValue(x: number, z: number): number {
  let m = 0;
  for (const rz of [boardSlot('near', 0, 1).pos.z, boardSlot('far', 0, 1).pos.z]) {
    const dz = Math.abs(z - rz);
    const ex = Math.max(0, Math.abs(x) - 6.9);
    const d = Math.hypot(ex, dz * 1.0);
    m = Math.max(m, 1 - smooth(0.72, 1.08, d));
  }
  return m;
}

function maskTexture(): THREE.DataTexture {
  const { w: MW, h: MH } = MASK_SIZE;
  const d = new Uint8Array(MW * MH * 4);
  for (let j = 0; j < MH; j++) {
    for (let i = 0; i < MW; i++) {
      const x = ((i + 0.5) / MW - 0.5) * TABLE.width;
      const z = ((j + 0.5) / MH - 0.5) * TABLE.depth;
      const h = terrainHeight(x, z);
      const dr = Math.abs(z - riverCenter(x));
      const k = (j * MW + i) * 4;
      d[k] = laneValue(x, z) * 255;
      // 湿泥：河岸往外 0.35 的一圈和整个河床
      d[k + 1] = (1 - smooth(1.0, 1.5, dr)) * 255;
      d[k + 2] = smooth(0.16, 0.5, h) * 255;
      d[k + 3] = clamp01((WATER_LEVEL - h) / 0.25) * 255;
    }
  }
  const t = dataTexture(d, MW, MH, false);
  t.anisotropy = 1;
  return t;
}

// 深色石材：大块的砌石接缝（沃罗诺伊边缘）加表面的细碎起伏。R 明暗，G、B 法线
function stoneTexture(): THREE.DataTexture {
  const N = 256;
  const hgt = new Float32Array(N * N);
  const shade = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const [, edge] = pvoronoi(u, v, 3, 13);
      const grain = pfbm(u, v, 16, 3, 77);
      const blot = pfbm(u, v, 4, 3, 5);
      const seam = smooth(0.0, 0.08, edge);
      hgt[y * N + x] = seam * 0.7 + grain * 0.3;
      shade[y * N + x] = (0.55 + 0.45 * seam) * (0.75 + 0.5 * blot) * (0.85 + 0.3 * grain);
    }
  }
  const nrm = heightToNormal(hgt, N, 6);
  const d = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    d[i * 4] = clamp01(shade[i]!) * 255;
    d[i * 4 + 1] = (nrm[i * 2]! * 0.5 + 0.5) * 255;
    d[i * 4 + 2] = (nrm[i * 2 + 1]! * 0.5 + 0.5) * 255;
    d[i * 4 + 3] = 255;
  }
  return dataTexture(d, N, N, true);
}

// 水面法线（切线空间，标准法线贴图格式）：两层噪声求梯度，可平铺
function waterTexture(): THREE.DataTexture {
  const N = 256;
  const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hgt[y * N + x] = pfbm(x / N, y / N, 4, 4, 201) + 0.35 * pfbm(x / N, y / N, 16, 2, 7);
  const nrm = heightToNormal(hgt, N, 9);
  const d = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const nx = nrm[i * 2]!;
    const ny = nrm[i * 2 + 1]!;
    d[i * 4] = (nx * 0.5 + 0.5) * 255;
    d[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    d[i * 4 + 2] = (Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 0.5 + 0.5) * 255;
    d[i * 4 + 3] = 255;
  }
  return dataTexture(d, N, N, true);
}

let cache: BoardTextures | null = null;

export function boardTextures(): BoardTextures {
  cache ??= { noise: noiseTexture(), grass: grassTexture(), mask: maskTexture(), stone: stoneTexture(), water: waterTexture() };
  return cache;
}
