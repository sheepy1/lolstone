// 成品图的尺寸和质量规则：按场景里实际画到多大决定缩到多大（spec 5.9、5.10）。
// scripts/optimize-art.ts 按它缩放、转 WebP；tests/presentation-card-art.test.ts 核对这里的窗口尺寸和场景一致。
//
// 原图和画到的贴图：
// - 卡面原画窗口：512×716 的卡面贴图里 380×327 的一块（src/scene/cardFrameArt.ts 的 ART），按 card-art.json 的 crop
//   取景后铺满它。符文之地传说的原画 2048×1024、皮肤原画 1215×717，取景区域只有几百像素就够。
// - 方形头像：256×256 的贴图（src/scene/canvasArt.ts 的 portraitTexture）。没有 icon 的卡从原画裁。
// - 英雄头像 128×128、竖版原画 308×560、技能和关键词图标 64×64：本来就不比画到的贴图大，只转格式不缩。
// 从不放大：取景区域已经比窗口小的（峡谷单位的 128×128 头像）原尺寸保留，场景里按小图放大处理（artDraw.ts）。

import { cropSource } from '../../src/scene/artDraw.ts';

export type ArtRole = 'hero_icon' | 'hero_loading' | 'card_art' | 'card_icon' | 'hero_power' | 'keyword';

/** 卡面原画窗口的尺寸（src/scene/cardFrameArt.ts 的 ART：380 × 380·0.86）。 */
export const FACE_WINDOW = { w: 380, h: 327 } as const;

/** 方形头像贴图的边长。 */
export const PORTRAIT_SIZE = 256;

/** 取景区域缩到窗口的几倍。留一点余量，场景里再缩一次时不损失细节；再大就只是白占字节。 */
export const OVERSAMPLE = 1.5;

/** WebP 质量（0 到 100）。原画、竖版原画 85 肉眼看不出和原图的差别；小图标在场景里放大两三倍看，用 90。 */
export const QUALITY: Record<ArtRole, number> = {
  hero_icon: 90,
  hero_loading: 85,
  card_art: 85,
  card_icon: 90,
  hero_power: 90,
  keyword: 90,
};

/** 改了规则（窗口、倍数、质量、编码参数）就加一，让 optimize-art.ts 把成品全部重做。 */
export const RULES_VERSION = 1;

export type ArtCrop = { focus: readonly [number, number]; zoom: number };

export const WHOLE_CROP: ArtCrop = { focus: [0.5, 0.5], zoom: 1 };

/** card-art.json 的 crop 字段：字符串是"整张用"的说明，对象才是取景（和 src/assets/cardArt.ts 的 parseCrop 一样）。 */
export function parseCrop(c: unknown): ArtCrop {
  if (c && typeof c === 'object' && 'focus' in c) {
    const o = c as { focus: [number, number]; zoom?: number };
    return { focus: o.focus, zoom: o.zoom ?? 1 };
  }
  return WHOLE_CROP;
}

export type Size = { w: number; h: number };

/**
 * 输出尺寸。card_art 按取景算：取景区域缩到卡面原画窗口的 OVERSAMPLE 倍；这张图还要裁方形头像时（没有 icon 的卡），
 * 取两者里要求更高的。其余角色不缩。整张图等比缩放，取景的 focus、zoom 不用改。
 */
export function targetSize(role: ArtRole, iw: number, ih: number, crop: ArtCrop, portraitFromArt: boolean): Size {
  if (role !== 'card_art') return { w: iw, h: ih };
  let k = OVERSAMPLE * FACE_WINDOW.w / cropSource(iw, ih, FACE_WINDOW.w, FACE_WINDOW.h, crop).w;
  if (portraitFromArt) k = Math.max(k, OVERSAMPLE * PORTRAIT_SIZE / cropSource(iw, ih, PORTRAIT_SIZE, PORTRAIT_SIZE, crop).w);
  if (k >= 1) return { w: iw, h: ih };
  return { w: Math.round(iw * k), h: Math.round(ih * k) };
}
