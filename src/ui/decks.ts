// 卡组（spec 2.1 组卡规则、5.1 卡组编辑页）：玩家自组卡组的存档、组卡规则的中文提示、开局时取卡组。
// 存在 localStorage 的 melol.decks，数据带版本号。读写都包 try/catch：存不下时只在本次生效。
// 读档时卡池里已经没有的卡跳过不要，记进 dropped，卡组页面上提示。
// 规则和 src/cards 的 validateDeck 一致（tests/decks.test.ts 核对两边的结论相同），这里给的是能直接显示的中文。
import { PRESET_DECKS, validateDeck } from '../cards';
import { allCards, findCard, getHeroClass, type CardDef, type HeroClass } from '../engine';

export const DECK_SIZE = 30;
export const MAX_COPIES = 2;
export const DECKS_KEY = 'melol.decks';
export const DECKS_VERSION = 1;

export type SavedDeck = {
  id: string;
  name: string;
  heroClass: HeroClass;
  cards: string[]; // 卡牌 id，同名的有几张就重复几次
  updatedAt: number;
};

type Stored = { version: number; decks: SavedDeck[] };

// 读档时跳过的卡：哪套卡组、哪些 id
export type DroppedCards = { deck: string; ids: string[] };

const HERO_CLASSES: readonly HeroClass[] = ['demacia', 'noxus', 'ionia', 'freljord'];

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// 能放进卡组的卡：不是衍生物、不是英雄技能、不是测试或隐藏用的卡
export function isCollectible(def: CardDef): boolean {
  return !def.token && def.type !== 'hero_power' && !def.id.startsWith('__');
}

// 某个职业能用的卡池：本职业卡和中立卡，按费用、职业卡在前、名字排
export function poolFor(heroClass: HeroClass): CardDef[] {
  return allCards()
    .filter((d) => isCollectible(d) && (d.class === heroClass || d.class === 'neutral'))
    .sort((a, b) => a.cost - b.cost || Number(a.class === 'neutral') - Number(b.class === 'neutral') || a.name.localeCompare(b.name, 'zh'));
}

export function countOf(cards: readonly string[], id: string): number {
  let n = 0;
  for (const c of cards) if (c === id) n++;
  return n;
}

// 这张卡现在能不能加进卡组；不能时返回给玩家看的原因
export function addProblem(cards: readonly string[], heroClass: HeroClass, cardId: string): string | null {
  const def = findCard(cardId);
  if (!def) return '卡池里没有这张卡';
  if (!isCollectible(def)) return '衍生物和英雄技能不能放进卡组';
  if (def.class !== 'neutral' && def.class !== heroClass) return `只能用${getHeroClass(heroClass).name}的职业卡和中立卡`;
  if (countOf(cards, cardId) >= MAX_COPIES) return `同名最多 ${MAX_COPIES} 张`;
  if (cards.length >= DECK_SIZE) return `卡组已满 ${DECK_SIZE} 张`;
  return null;
}

// 整套卡组的问题（空数组表示可以用来开局），给玩家看的中文
export function deckProblems(cards: readonly string[], heroClass: HeroClass): string[] {
  const out: string[] = [];
  if (cards.length < DECK_SIZE) out.push(`还差 ${DECK_SIZE - cards.length} 张才满 ${DECK_SIZE} 张`);
  if (cards.length > DECK_SIZE) out.push(`多了 ${cards.length - DECK_SIZE} 张，卡组只能有 ${DECK_SIZE} 张`);
  const seen = new Set<string>();
  for (const id of cards) {
    if (seen.has(id)) continue;
    seen.add(id);
    const def = findCard(id);
    if (!def) {
      out.push(`卡池里没有 ${id}`);
      continue;
    }
    const n = countOf(cards, id);
    if (n > MAX_COPIES) out.push(`「${def.name}」有 ${n} 张，同名最多 ${MAX_COPIES} 张`);
    if (!isCollectible(def)) out.push(`「${def.name}」是衍生物，不能放进卡组`);
    else if (def.class !== 'neutral' && def.class !== heroClass) out.push(`「${def.name}」不是${getHeroClass(heroClass).name}的卡`);
  }
  return out;
}

export function isPlayable(deck: Pick<SavedDeck, 'cards' | 'heroClass'>): boolean {
  return deckProblems(deck.cards, deck.heroClass).length === 0 && validateDeck(deck.cards, deck.heroClass, allCards()).length === 0;
}

// 按费用、名字排好的卡组内容：[卡, 张数]
export function deckRows(cards: readonly string[]): { def: CardDef; count: number }[] {
  const rows = new Map<string, number>();
  for (const id of cards) rows.set(id, (rows.get(id) ?? 0) + 1);
  return [...rows]
    .map(([id, count]) => ({ def: findCard(id), count }))
    .filter((r): r is { def: CardDef; count: number } => !!r.def)
    .sort((a, b) => a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name, 'zh'));
}

// 法力曲线：0 到 6 各一档，7 费及以上合成一档
export function manaCurve(cards: readonly string[]): number[] {
  const bins = Array.from({ length: 8 }, () => 0);
  for (const id of cards) {
    const def = findCard(id);
    if (def) bins[Math.min(7, def.cost)]!++;
  }
  return bins;
}

// ---------- 存档 ----------

// 解析存档：版本不认识、格式坏了时返回空；卡池里没有的卡跳过并记下。
export function parseDecks(raw: string | null | undefined): { decks: SavedDeck[]; dropped: DroppedCards[]; unreadable: boolean } {
  if (!raw) return { decks: [], dropped: [], unreadable: false };
  let data: Partial<Stored>;
  try {
    data = JSON.parse(raw) as Partial<Stored>;
  } catch {
    return { decks: [], dropped: [], unreadable: true };
  }
  if (data.version !== DECKS_VERSION || !Array.isArray(data.decks)) return { decks: [], dropped: [], unreadable: true };
  const decks: SavedDeck[] = [];
  const dropped: DroppedCards[] = [];
  for (const d of data.decks as Partial<SavedDeck>[]) {
    if (!d || typeof d.id !== 'string' || typeof d.name !== 'string' || !HERO_CLASSES.includes(d.heroClass as HeroClass) || !Array.isArray(d.cards)) continue;
    const ids = d.cards.filter((c): c is string => typeof c === 'string');
    const known = ids.filter((c) => !!findCard(c));
    const unknown = [...new Set(ids.filter((c) => !findCard(c)))];
    if (unknown.length > 0) dropped.push({ deck: d.name, ids: unknown });
    decks.push({ id: d.id, name: d.name, heroClass: d.heroClass as HeroClass, cards: known, updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0 });
  }
  return { decks, dropped, unreadable: false };
}

export function serializeDecks(decks: readonly SavedDeck[]): string {
  return JSON.stringify({ version: DECKS_VERSION, decks: [...decks] } satisfies Stored);
}

let cache: { decks: SavedDeck[]; dropped: DroppedCards[] } | null = null;

export function loadDecks(): { decks: SavedDeck[]; dropped: DroppedCards[] } {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(DECKS_KEY) ?? null;
  } catch {
    raw = null;
  }
  const r = parseDecks(raw);
  // 读不懂的存档（比如以后的新版本）先备份一份，免得下次保存时被覆盖掉
  if (r.unreadable && raw) {
    try {
      storage()?.setItem(`${DECKS_KEY}.backup`, raw);
    } catch {
      // 备份不了也不影响使用
    }
  }
  cache = { decks: r.decks, dropped: r.dropped };
  return cache;
}

const listeners = new Set<() => void>();

export function onDecksChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function commit(decks: SavedDeck[]): void {
  cache = { decks, dropped: cache?.dropped ?? [] };
  try {
    storage()?.setItem(DECKS_KEY, serializeDecks(decks));
  } catch {
    // 存不下就只在本次生效
  }
  for (const fn of listeners) fn();
}

// 测试用：丢掉缓存，下次从存储重新读
export function resetDeckCache(): void {
  cache = null;
}

export function clearDroppedNotice(): void {
  if (cache) cache = { ...cache, dropped: [] };
  for (const fn of listeners) fn();
}

function newId(): string {
  return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function getDeck(id: string): SavedDeck | null {
  return loadDecks().decks.find((d) => d.id === id) ?? null;
}

export function createDeck(heroClass: HeroClass, name: string, cards: readonly string[] = []): SavedDeck {
  const deck: SavedDeck = { id: newId(), name: name.trim() || '新卡组', heroClass, cards: [...cards], updatedAt: Date.now() };
  commit([...loadDecks().decks, deck]);
  return deck;
}

export function saveDeckCards(id: string, cards: readonly string[]): void {
  commit(loadDecks().decks.map((d) => (d.id === id ? { ...d, cards: [...cards], updatedAt: Date.now() } : d)));
}

export function renameDeck(id: string, name: string): void {
  const n = name.trim();
  if (!n) return;
  commit(loadDecks().decks.map((d) => (d.id === id ? { ...d, name: n, updatedAt: Date.now() } : d)));
}

export function deleteDeck(id: string): void {
  commit(loadDecks().decks.filter((d) => d.id !== id));
}

// 新卡组的默认名字：「德玛西亚卡组 2」这样不和已有的重名
export function defaultDeckName(heroClass: HeroClass, suffix = '卡组'): string {
  const base = `${getHeroClass(heroClass).name}${suffix}`;
  const names = new Set(loadDecks().decks.map((d) => d.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ---------- 预组 ----------

export const PRESET_PREFIX = 'preset:';
export const PRESET_STYLE: Record<HeroClass, string> = { demacia: '铺场', noxus: '快攻', ionia: '节奏', freljord: '控制' };

export function presetDeck(heroClass: HeroClass): SavedDeck {
  return {
    id: `${PRESET_PREFIX}${heroClass}`,
    name: `${getHeroClass(heroClass).name}预组 · ${PRESET_STYLE[heroClass]}`,
    heroClass,
    cards: [...(PRESET_DECKS[heroClass] ?? [])],
    updatedAt: 0,
  };
}

export function isPreset(id: string): boolean {
  return id.startsWith(PRESET_PREFIX);
}

// 开局用的卡组：deckId 为空或者是预组时用预组；自组卡组不存在或不能用（不满 30 张、不合规）时也退回预组。
export function deckForMatch(heroClass: HeroClass, deckId: string | null): SavedDeck {
  if (deckId && !isPreset(deckId)) {
    const d = getDeck(deckId);
    if (d && d.heroClass === heroClass && isPlayable(d)) return d;
  }
  return presetDeck(heroClass);
}
