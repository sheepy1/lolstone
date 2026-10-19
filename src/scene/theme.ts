// 配色和字体（spec 5.4）。M3 用纯色和简单几何体占位，M4 换贴图和材质。
import type { CardClass, Fx } from '../engine';

export const FONT_CN = '"LXGW WenKai", "Songti SC", "Noto Serif SC", "PingFang SC", serif';
export const FONT_NUM = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

// 卡框按地区配色：德玛西亚金白，诺克萨斯红黑，艾欧尼亚粉紫，弗雷尔卓德冰蓝，中立石灰。
export const REGION_COLORS: Record<CardClass, { frame: number; inner: number; accent: number }> = {
  demacia: { frame: 0xd8c27a, inner: 0xf3ecd6, accent: 0xb08a2e },
  noxus: { frame: 0x8e1f24, inner: 0x2a1416, accent: 0xd23b3b },
  ionia: { frame: 0xc77dbb, inner: 0x3a2440, accent: 0xf0a6d8 },
  freljord: { frame: 0x7fc4e8, inner: 0x1c3446, accent: 0xc9ecff },
  neutral: { frame: 0x8a8a80, inner: 0x2d2d2a, accent: 0xb8b8ae },
};

export const FX_COLORS: Record<Fx, number> = {
  physical: 0xe8d6b0,
  fire: 0xff7a2a,
  frost: 0x8fdcff,
  holy: 0xfff1a0,
  shadow: 0x9a5cff,
};

export const COLORS = {
  boardGround: 0x1d3b2a,
  boardEdge: 0x14271c,
  lane: 0x2a4d36,
  river: 0x1f5a73,
  riverLight: 0x3f8fae,
  hpSegment: 0x3fcf4f,
  hpSegmentEnemy: 0xe04848,
  hpBack: 0x101418,
  shield: 0xffffff,
  mana: 0x2f8cff,
  manaEmpty: 0x1a2a40,
  manaTemp: 0x45e0d0,
  textLight: 0xf4f0e6,
  buffed: 0x5cff6a,
  debuffed: 0xff5a5a,
  playable: 0x3dff6e,
  target: 0xff3b3b,
  taunt: 0xf0c040,
  frost: 0x9fe2ff,
  cardBack: 0x1b2440,
  cardBackAccent: 0x3a6fb0,
  hexGold: 0xc8aa6e,
};

// 没有头像图时的纯色兜底：按卡牌 id 哈希出一个颜色，同一张卡颜色固定。
export function fallbackColor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360;
  return hslToHex(hue, 0.45, 0.42);
}

function hslToHex(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

// 0xRRGGBB 转成 canvas 用的颜色字符串
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
