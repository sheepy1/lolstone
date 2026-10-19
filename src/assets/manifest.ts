// 资源清单（spec 5.9）。英雄美术和语音由 scripts/fetch-art.ts、fetch-voice.ts 拉到 public/，
// 路径按英雄 key 的小写目录名排：art/<key>/icon.png、art/<key>/loading.jpg、audio/voice/<key>/choose.ogg。
// 加载页按这里的清单预载本局两套卡组用到的资源（spec 5.10）。
import { getCard, getHeroClass, type HeroClass } from '../engine';

export type AssetKind = 'icon' | 'loading' | 'voice_choose' | 'voice_ban';

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

// 本局要预载的资源：双方卡组里卡牌的英雄（包括它们能召唤、变形出来的衍生物不需要，衍生物没有英雄美术），加上双方职业英雄。
export function matchManifest(decks: readonly (readonly string[])[], classes: readonly HeroClass[]): AssetEntry[] {
  const keys = new Set<string>();
  for (const cls of classes) keys.add(heroChampion(cls));
  for (const deck of decks) {
    for (const id of deck) {
      const key = championOf(id);
      if (key) keys.add(key);
    }
  }
  // 变形、召唤能产生卡组外的英雄随从（冰凤凰蛋变艾尼维亚）。艾尼维亚本身也在弗雷尔卓德卡组里，
  // 这里不追效果链；漏掉的头像在用到时按需加载，加载前用纯色兜底。
  const out: AssetEntry[] = [];
  for (const key of keys) {
    out.push({ kind: 'icon', key, url: iconUrl(key) });
    out.push({ kind: 'loading', key, url: loadingArtUrl(key) });
    out.push({ kind: 'voice_choose', key, url: voiceUrl(key, 'choose') });
    out.push({ kind: 'voice_ban', key, url: voiceUrl(key, 'ban') });
  }
  return out;
}
