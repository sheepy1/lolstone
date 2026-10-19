// 把预设数据编译成每帧直接查表的形式：区间拆成 min / max，曲线和颜色渐变烘成 32 格的查找表。
// 每帧更新只做查表和插值，不解析数据、不分配对象。
import * as THREE from 'three';
import { CELLS, type ColorRef, type Curve, type GradientStop, type Layer, type PresetDef, type Range } from './types';

export const LUT_SIZE = 32;

export type CompiledLayer = {
  src: Layer;
  cell: number;
  lifeMin: number;
  lifeMax: number;
  speedMin: number;
  speedMax: number;
  sizeMin: number;
  sizeMax: number;
  spinMin: number;
  spinMax: number;
  flipMin: number;
  flipMax: number;
  hMin: number;
  hMax: number;
  sizeLut: Float32Array;
  alphaLut: Float32Array;
  // 按主色缓存的颜色查找表（rgb 交错，线性色彩空间，已乘亮度）
  colorLuts: Map<number, Float32Array>;
  paletteCache: Map<number, Float32Array>;
};

export type CompiledPreset = {
  def: PresetDef;
  layers: CompiledLayer[];
};

const lo = (r: Range) => (typeof r === 'number' ? r : r[0]);
const hi = (r: Range) => (typeof r === 'number' ? r : r[1]);

export function bakeCurve(curve: Curve | undefined, fallback: number): Float32Array {
  const out = new Float32Array(LUT_SIZE);
  if (!curve || curve.length === 0) return out.fill(fallback);
  for (let i = 0; i < LUT_SIZE; i++) out[i] = sampleCurve(curve, i / (LUT_SIZE - 1));
  return out;
}

function sampleCurve(curve: Curve, t: number): number {
  if (t <= curve[0]![0]) return curve[0]![1];
  for (let k = 1; k < curve.length; k++) {
    const [t1, v1] = curve[k]!;
    if (t <= t1) {
      const [t0, v0] = curve[k - 1]!;
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 + (v1 - v0) * f;
    }
  }
  return curve[curve.length - 1]![1];
}

const tmp = new THREE.Color();
const white = new THREE.Color(0xffffff);

// 颜色引用 → 线性 rgb
export function resolveColor(ref: ColorRef, main: number, out: THREE.Color): THREE.Color {
  if (typeof ref === 'number') return out.setHex(ref);
  out.setHex(main);
  if (ref === 'hot') out.lerp(white, 0.6);
  else if (ref === 'deep') out.multiplyScalar(0.35);
  return out;
}

export function bakeGradient(stops: readonly GradientStop[], main: number): Float32Array {
  const out = new Float32Array(LUT_SIZE * 3);
  const a = new THREE.Color();
  const b = new THREE.Color();
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    let k = 1;
    while (k < stops.length - 1 && t > stops[k]![0]) k++;
    const s0 = stops[Math.max(0, k - 1)]!;
    const s1 = stops[Math.min(stops.length - 1, k)]!;
    const span = s1[0] - s0[0];
    const f = stops.length === 1 || span <= 0 ? (t >= s1[0] ? 1 : 0) : Math.min(1, Math.max(0, (t - s0[0]) / span));
    resolveColor(s0[1], main, a).multiplyScalar(s0[2]);
    resolveColor(s1[1], main, b).multiplyScalar(s1[2]);
    a.lerp(b, f);
    out[i * 3] = a.r;
    out[i * 3 + 1] = a.g;
    out[i * 3 + 2] = a.b;
  }
  return out;
}

export function compilePreset(def: PresetDef): CompiledPreset {
  return {
    def,
    layers: def.layers.map((l) => {
      const height = l.shape.kind === 'disc' ? (l.shape.height ?? 0) : 0;
      return {
        src: l,
        cell: CELLS.indexOf(l.cell),
        lifeMin: lo(l.life),
        lifeMax: hi(l.life),
        speedMin: lo(l.speed),
        speedMax: hi(l.speed),
        sizeMin: lo(l.size),
        sizeMax: hi(l.size),
        spinMin: lo(l.spin ?? 0),
        spinMax: hi(l.spin ?? 0),
        flipMin: lo(l.flip ?? 0),
        flipMax: hi(l.flip ?? 0),
        hMin: lo(height),
        hMax: hi(height),
        sizeLut: bakeCurve(l.sizeCurve, 1),
        alphaLut: bakeCurve(l.alphaCurve, 1),
        colorLuts: new Map(),
        paletteCache: new Map(),
      };
    }),
  };
}

export function colorLut(layer: CompiledLayer, main: number): Float32Array {
  let lut = layer.colorLuts.get(main);
  if (!lut) {
    lut = bakeGradient(layer.src.gradient, main);
    layer.colorLuts.set(main, lut);
  }
  return lut;
}

// 调色板（rgb 交错）
export function paletteOf(layer: CompiledLayer, main: number): Float32Array | null {
  const p = layer.src.palette;
  if (!p) return null;
  let out = layer.paletteCache.get(main);
  if (!out) {
    out = new Float32Array(p.length * 3);
    p.forEach((ref, i) => {
      resolveColor(ref, main, tmp);
      out![i * 3] = tmp.r;
      out![i * 3 + 1] = tmp.g;
      out![i * 3 + 2] = tmp.b;
    });
    layer.paletteCache.set(main, out);
  }
  return out;
}

// 查找表插值，t 在 0 到 1
export function lut1(lut: Float32Array, t: number): number {
  const f = t * (LUT_SIZE - 1);
  const i = f | 0;
  if (i >= LUT_SIZE - 1) return lut[LUT_SIZE - 1]!;
  const k = f - i;
  return lut[i]! + (lut[i + 1]! - lut[i]!) * k;
}

// 种子随机数（mulberry32），测试和截图可复现
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}
