// 非英雄卡、英雄技能、关键词的配图映射表（scripts/data/card-art.json）的类型和地址解析。
// fetch-icons.ts 按它下载，art-review.ts 按它出对照页。

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DDRAGON } from './ddragon.ts';

export const CARD_ART_JSON = path.resolve(import.meta.dirname, '../data/card-art.json');

const CDRAGON = 'https://raw.communitydragon.org/latest';
const LOR = 'https://dd.b.pvp.net';

/**
 * 一张图的来源：
 * - ddragon-spell：英雄技能和召唤师技能图标，64×64，地址带 Data Dragon 版本号。
 * - ddragon-passive：英雄被动图标，64×64，带版本号。
 * - ddragon-item：物品图标，64×64，带版本号。
 * - ddragon-splash：英雄皮肤原画，1215×717 横图。地址不带版本号（带了返回 403）。
 * - cdragon：CommunityDragon 游戏文件镜像里的任意路径，比如野怪、小兵的 hud 方形头像（128×128）。
 * - lor：符文之地传说（Legends of Runeterra）的卡牌原画，2048×1024 横图，0.5 到 2 MB 一张，服务器慢。
 */
export type ArtSource =
  | { type: 'ddragon-spell'; key: string }
  | { type: 'ddragon-passive'; file: string }
  | { type: 'ddragon-item'; id: string }
  | { type: 'ddragon-splash'; champion: string; skin: number }
  | { type: 'cdragon'; path: string }
  | { type: 'lor'; set: string; code: string };

/**
 * 裁切建议。字符串是整张用时的说明。对象形式：
 * - focus：画面主体中心在原图里的位置（0 到 1，左上为原点），卡面原画窗口按自己的宽高比以它为中心裁。
 * - zoom：在「刚好铺满窗口」的基础上再放大几倍，默认 1。符文之地传说的法术原画是黑底上的圆，要放大才不露黑角。
 */
export type Crop = string | { focus: [number, number]; zoom?: number; note?: string };

export type Alt = ArtSource & { note: string };

export type CardArt = {
  name: string;
  /** 场上随从头像、小图标用的方图。null 表示没有现成的，从 art 裁。 */
  icon: ArtSource | null;
  /** 卡面原画窗口用的图。 */
  art: ArtSource & { crop: Crop };
  reason: string;
  /** 官方没有合适的图，理想做法是生成。值是生成要求。 */
  generate?: string;
  alts: Alt[];
};

export type IconArt = {
  name: string;
  icon: ArtSource;
  reason: string;
  alts: Alt[];
};

export type CardArtMap = {
  lorVersion: string;
  cards: Record<string, CardArt>;
  heroPowers: Record<string, IconArt>;
  keywords: Record<string, IconArt>;
};

export async function loadCardArtMap(): Promise<CardArtMap> {
  return JSON.parse(await readFile(CARD_ART_JSON, 'utf8')) as CardArtMap;
}

/** 来源的下载地址和文件扩展名。 */
export function resolveSource(src: ArtSource, ddVersion: string, lorVersion: string): { url: string; ext: string } {
  switch (src.type) {
    case 'ddragon-spell':
      return { url: `${DDRAGON}/cdn/${ddVersion}/img/spell/${src.key}.png`, ext: '.png' };
    case 'ddragon-passive':
      return { url: `${DDRAGON}/cdn/${ddVersion}/img/passive/${src.file}`, ext: path.extname(src.file) };
    case 'ddragon-item':
      return { url: `${DDRAGON}/cdn/${ddVersion}/img/item/${src.id}.png`, ext: '.png' };
    case 'ddragon-splash':
      return { url: `${DDRAGON}/cdn/img/champion/splash/${src.champion}_${src.skin}.jpg`, ext: '.jpg' };
    case 'cdragon':
      return { url: `${CDRAGON}/${src.path}`, ext: path.extname(src.path) };
    case 'lor':
      return { url: `${LOR}/${lorVersion}/${src.set}/en_us/img/cards/${src.code}-full.png`, ext: '.png' };
  }
}

