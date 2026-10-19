// 非英雄卡、英雄技能、关键词的配图地址（spec 5.9）。映射表是 scripts/data/card-art.json，图由 scripts/fetch-icons.ts
// 下载到 public/art/cards、public/art/heropowers、public/art/keywords（不进 git）。这里按映射表算出下载后的本地路径，
// 规则和 fetch-icons.ts 一致：
//   art/cards/<卡牌 id>/icon.<扩展名>  场上头像用的方图；映射表 icon 为 null 时没有
//   art/cards/<卡牌 id>/art.<扩展名>   卡面原画窗口用的图；和 icon 同一个来源时不另存，指向 icon 那个文件
//   art/heropowers/<职业>.png、art/keywords/<关键词>.png
// tests/presentation-card-art.test.ts 拿 scripts/lib/art-sources.ts 的 resolveSource 核对扩展名，两边改了一边会报错。
import map from '../../scripts/data/card-art.json';
import type { HeroClass } from '../engine';

type Source =
  | { type: 'ddragon-spell'; key: string }
  | { type: 'ddragon-passive'; file: string }
  | { type: 'ddragon-item'; id: string }
  | { type: 'ddragon-splash'; champion: string; skin: number }
  | { type: 'cdragon'; path: string }
  | { type: 'lor'; set: string; code: string };

type RawCard = { icon: Source | null; art: Source & { crop: unknown }; generate?: string };

/** 原画窗口的裁切：focus 是主体中心（0 到 1，左上为原点），zoom 是在刚好铺满窗口的基础上再放大几倍。 */
export type ArtCrop = { focus: readonly [number, number]; zoom: number };

export type CardArtEntry = {
  /** 卡面原画窗口用的图。 */
  art: string;
  /** 场上随从头像用的方图；没有时从 art 裁。 */
  icon: string | null;
  crop: ArtCrop;
  /** 映射表标了以后生成大图（现在是小图放大，偏糊）。 */
  generate: boolean;
};

const WHOLE: ArtCrop = { focus: [0.5, 0.5], zoom: 1 };

const base = (): string => {
  const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
};

const extname = (p: string): string => {
  const m = /\.[^./]+$/.exec(p);
  return m ? m[0] : '';
};

/** 来源下载后的文件扩展名，和 scripts/lib/art-sources.ts 的 resolveSource 一致。 */
export function sourceExt(src: Source): string {
  switch (src.type) {
    case 'ddragon-passive':
      return extname(src.file);
    case 'ddragon-splash':
      return '.jpg';
    case 'cdragon':
      return extname(src.path);
    default:
      return '.png';
  }
}

const sameSource = (a: Source, b: Source): boolean => {
  const { crop: _a, ...ra } = a as Source & { crop?: unknown };
  const { crop: _b, ...rb } = b as Source & { crop?: unknown };
  return JSON.stringify(ra) === JSON.stringify(rb);
};

function parseCrop(c: unknown): ArtCrop {
  if (c && typeof c === 'object' && 'focus' in c) {
    const o = c as { focus: [number, number]; zoom?: number };
    return { focus: o.focus, zoom: o.zoom ?? 1 };
  }
  return WHOLE; // 字符串是"整张用"的说明
}

const cards = map.cards as unknown as Record<string, RawCard>;
const entries = new Map<string, CardArtEntry>();

/** 一张卡的配图；映射表里没有（英雄卡）时返回 null。 */
export function cardArtOf(cardId: string): CardArtEntry | null {
  const hit = entries.get(cardId);
  if (hit) return hit;
  const raw = cards[cardId];
  if (!raw) return null;
  const dir = `${base()}art/cards/${cardId}`;
  const icon = raw.icon ? `${dir}/icon${sourceExt(raw.icon)}` : null;
  const art = raw.icon && sameSource(raw.icon, raw.art) ? icon! : `${dir}/art${sourceExt(raw.art)}`;
  const e: CardArtEntry = { art, icon, crop: parseCrop(raw.art.crop), generate: !!raw.generate };
  entries.set(cardId, e);
  return e;
}

export function mappedCardIds(): string[] {
  return Object.keys(cards);
}

/** 英雄技能按钮的图标。 */
export function heroPowerIconUrl(cls: HeroClass): string | null {
  const hp = (map.heroPowers as Record<string, { icon: Source }>)[`${cls}.hero_power`];
  return hp ? `${base()}art/heropowers/${cls}${sourceExt(hp.icon)}` : null;
}

/** 关键词 buff 小图标（嘲讽、剧毒、沉默……）。 */
export function keywordIconUrl(keyword: string): string | null {
  const kw = (map.keywords as Record<string, { icon: Source }>)[keyword];
  return kw ? `${base()}art/keywords/${keyword}${sourceExt(kw.icon)}` : null;
}

export function mappedKeywords(): string[] {
  return Object.keys(map.keywords);
}
