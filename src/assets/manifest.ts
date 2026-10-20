// 资源清单（spec 5.9）。英雄美术和语音由 scripts/fetch-art.ts、fetch-voice.ts 拉到 public/，
// 路径按英雄 key 的小写目录名排：art/<key>/icon.png、art/<key>/loading.jpg、audio/voice/<key>/choose.ogg。
// 非英雄卡、英雄技能、关键词的配图路径见 cardArt.ts。
// 加载页按这里的清单预载本局两套卡组用到的资源（spec 5.10）。
import { findCard, getCard, getHeroClass, MANA_POTION_ID, type HeroClass } from '../engine';
import { cardArtOf, heroPowerIconUrl, keywordIconUrl, mappedKeywords } from './cardArt';

export type AssetKind = 'icon' | 'loading' | 'voice_choose' | 'voice_ban' | 'card_art' | 'card_icon' | 'hero_power' | 'keyword';

/** 图片类的资源（其余是语音）。 */
export const IMAGE_KINDS: readonly AssetKind[] = ['icon', 'loading', 'card_art', 'card_icon', 'hero_power', 'keyword'];

export type AssetEntry = { kind: AssetKind; key: string; url: string };

const base = (): string => {
  const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
};

export function assetDir(championKey: string): string {
  return championKey.toLowerCase();
}

export function iconUrl(championKey: string): string {
  return `${base()}art/${assetDir(championKey)}/icon.png`;
}

export function loadingArtUrl(championKey: string): string {
  return `${base()}art/${assetDir(championKey)}/loading.jpg`;
}

// 卡面文字用的字体：思源宋体粗体按卡池用到的字做的子集
export function cardFontUrl(): string {
  return `${base()}fonts/lolstone-serif-sc.woff`;
}

export function voiceUrl(championKey: string, which: 'choose' | 'ban'): string {
  return `${base()}audio/voice/${assetDir(championKey)}/${which}.ogg`;
}

// 一张卡对应的英雄 key。小兵、野怪、法术、衍生物没有英雄，返回 null，画面用纯色兜底。
export function championOf(cardId: string): string | null {
  return getCard(cardId).champion ?? null;
}

export function heroChampion(cls: HeroClass): string {
  return getHeroClass(cls).champion;
}

// 卡牌效果里引用到的其他卡（召唤的衍生物、变形成的卡），连同它们再引用的，一直追到底。
function withReferencedCards(ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    const def = findCard(id);
    if (!def) return;
    out.add(id);
    collectIds(def.effects, visit);
  };
  for (const id of ids) visit(id);
  return out;
}

function collectIds(v: unknown, visit: (id: string) => void): void {
  if (typeof v === 'string') {
    if (findCard(v)) visit(v);
  } else if (Array.isArray(v)) {
    for (const x of v) collectIds(x, visit);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) collectIds(x, visit);
  }
}

// 本局要预载的资源：双方卡组里卡牌的英雄美术和语音、双方职业英雄；卡组里的卡、它们能召唤或变形出来的衍生物、
// 后手拿到的法力药水、两个英雄技能召唤的衍生物的配图（cardArt.ts）；两个英雄技能的图标；全部关键词图标（一共 11 个小图）。
export function matchManifest(decks: readonly (readonly string[])[], classes: readonly HeroClass[]): AssetEntry[] {
  const keys = new Set<string>();
  for (const cls of classes) keys.add(heroChampion(cls));
  const cards = withReferencedCards([...decks.flat(), MANA_POTION_ID, ...classes.map((c) => getHeroClass(c).heroPower)]);
  for (const id of cards) {
    const key = championOf(id);
    if (key) keys.add(key);
  }
  const out: AssetEntry[] = [];
  for (const key of keys) {
    out.push({ kind: 'icon', key, url: iconUrl(key) });
    out.push({ kind: 'loading', key, url: loadingArtUrl(key) });
    out.push({ kind: 'voice_choose', key, url: voiceUrl(key, 'choose') });
    out.push({ kind: 'voice_ban', key, url: voiceUrl(key, 'ban') });
  }
  const urls = new Set<string>();
  const add = (kind: AssetKind, key: string, url: string | null) => {
    if (!url || urls.has(url)) return;
    urls.add(url);
    out.push({ kind, key, url });
  };
  for (const id of cards) {
    const art = cardArtOf(id);
    if (!art) continue;
    add('card_art', id, art.art);
    add('card_icon', id, art.icon);
  }
  for (const cls of classes) add('hero_power', cls, heroPowerIconUrl(cls));
  for (const kw of mappedKeywords()) add('keyword', kw, keywordIconUrl(kw));
  return out;
}
