// 粒子贴图图集：8 个格子，4 列 2 行，每格 128 像素，程序生成（DataTexture，不依赖 DOM，Node 里也能建）。
// rgb 是明暗（颜色由每个粒子乘上去），a 是覆盖率。格子顺序和 types.ts 的 CELLS 一致。
import * as THREE from 'three';
import { CELLS, type Cell } from './types';

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;
const CELL_PX = 128;

type Px = { l: number; a: number };
type Painter = (x: number, y: number) => Px;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// 格子坐标 x、y 在 -1 到 1，y 向上。内容都收在半径 0.95 以内，给 mipmap 留边。
const PAINTERS: Record<Cell, Painter> = {
  // 柔和光晕：亮核加高斯外晕
  glow: (x, y) => {
    const r2 = x * x + y * y;
    const a = (Math.exp(-r2 * 7) * 0.7 + Math.exp(-r2 * 40) * 0.3) * smooth(1, 0.8, Math.sqrt(r2));
    return { l: 1, a };
  },
  // 余烬、火花头：很紧的亮点
  ember: (x, y) => {
    const r2 = x * x + y * y;
    const a = (Math.exp(-r2 * 22) + Math.exp(-r2 * 5) * 0.18) * smooth(1, 0.85, Math.sqrt(r2));
    return { l: 1, a: clamp01(a) };
  },
  // 碎片：不规则的四边形，两个面明暗不同，边缘一圈亮线
  shard: (x, y) => {
    const poly: [number, number][] = [
      [0.02, 0.94],
      [0.46, 0.12],
      [0.1, -0.9],
      [-0.4, -0.08],
    ];
    const d = polyDist(poly, x, y);
    if (d > 0.04) return { l: 0, a: 0 };
    const facet = x * 1.6 - y * 0.08 > 0.03 ? 1 : 0.62;
    const rim = smooth(-0.1, -0.015, d) * 0.5;
    return { l: Math.min(1, facet + rim), a: smooth(0.04, -0.01, d) };
  },
  // 烟团：多层噪声乘径向衰减，上半边略亮（顶光）
  smoke: (x, y) => {
    const r = Math.sqrt(x * x + y * y);
    const n = fbm(x * 2.2 + 7.3, y * 2.2 + 1.7);
    const a = smooth(1, 0.05, r + (n - 0.5) * 0.3) * (0.62 + 0.38 * n);
    return { l: clamp01(0.72 + 0.22 * n + 0.12 * y), a: clamp01(a) };
  },
  // 纸屑：圆角长方形，一侧略暗
  flake: (x, y) => {
    const qx = Math.abs(x) - 0.42;
    const qy = Math.abs(y) - 0.78;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.08;
    return { l: 0.85 + 0.15 * clamp01(0.5 - x), a: smooth(0.04, -0.02, d) };
  },
  // 冲击环
  ring: (x, y) => {
    const r = Math.sqrt(x * x + y * y);
    const band = Math.exp(-(((r - 0.84) / 0.07) ** 2));
    const inner = r < 0.84 ? 0.1 * smooth(0.2, 0.84, r) : 0;
    return { l: 1, a: clamp01(band + inner) * smooth(0.98, 0.92, r) };
  },
  // 四角星闪
  star: (x, y) => {
    const r2 = x * x + y * y;
    const ax = Math.exp(-Math.abs(y) * 16) * Math.exp(-x * x * 2.5);
    const ay = Math.exp(-Math.abs(x) * 16) * Math.exp(-y * y * 2.5);
    const a = (Math.max(ax, ay) * 0.9 + Math.exp(-r2 * 30)) * smooth(1, 0.85, Math.sqrt(r2));
    return { l: 1, a: clamp01(a) };
  },
  // 刀光：月牙，沿 x 方向展开，中段最亮最粗，两头变细
  arc: (x, y) => {
    const cx = 0;
    const cy = -1.25;
    const R = 1.75;
    const d = Math.hypot(x - cx, y - cy) - R;
    const along = clamp01(1 - x * x);
    const w = 0.03 + 0.17 * along;
    const a = Math.exp(-((d / w) ** 2)) * along ** 1.2 * smooth(1, 0.9, Math.abs(x));
    return { l: 1, a: clamp01(a * 1.2) };
  },
};

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    v += vnoise(x * f, y * f) * amp;
    f *= 2;
    amp *= 0.5;
  }
  return v / 0.9375;
}

// 点到凸多边形的有符号距离（里面为负）
function polyDist(poly: [number, number][], x: number, y: number): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % poly.length]!;
    const ex = bx - ax;
    const ey = by - ay;
    const t = clamp01(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey));
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
    if (ex * (y - ay) - ey * (x - ax) > 0) inside = false;
  }
  return inside ? -best : best;
}

export function buildAtlasPixels(): Uint8Array {
  const w = ATLAS_COLS * CELL_PX;
  const h = ATLAS_ROWS * CELL_PX;
  const data = new Uint8Array(w * h * 4);
  CELLS.forEach((cell, i) => {
    const paint = PAINTERS[cell];
    const ox = (i % ATLAS_COLS) * CELL_PX;
    const oy = Math.floor(i / ATLAS_COLS) * CELL_PX;
    for (let py = 0; py < CELL_PX; py++) {
      for (let px = 0; px < CELL_PX; px++) {
        const x = ((px + 0.5) / CELL_PX) * 2 - 1;
        const y = ((py + 0.5) / CELL_PX) * 2 - 1;
        const { l, a } = paint(x * 1.04, y * 1.04);
        const o = ((oy + py) * w + ox + px) * 4;
        const lv = Math.round(clamp01(l) * 255);
        data[o] = lv;
        data[o + 1] = lv;
        data[o + 2] = lv;
        data[o + 3] = Math.round(clamp01(a) * 255);
      }
    }
  });
  return data;
}

// 图集贴图归 ParticleSystem 所有，系统销毁时释放
export function createAtlas(): THREE.DataTexture {
  const tex = new THREE.DataTexture(buildAtlasPixels(), ATLAS_COLS * CELL_PX, ATLAS_ROWS * CELL_PX, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'particle-atlas';
  tex.needsUpdate = true;
  return tex;
}
