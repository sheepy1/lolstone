// 卡组存档和组卡规则（src/ui/decks.ts）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_DECKS, validateDeck } from '../src/cards';
import { allCards } from '../src/engine';
import {
  addProblem,
  createDeck,
  deckForMatch,
  deckProblems,
  deckRows,
  DECKS_KEY,
  deleteDeck,
  getDeck,
  isPlayable,
  loadDecks,
  manaCurve,
  parseDecks,
  poolFor,
  renameDeck,
  resetDeckCache,
  saveDeckCards,
  serializeDecks,
} from '../src/ui/decks';

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

let store: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal('localStorage', store);
  resetDeckCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetDeckCache();
});

describe('组卡规则', () => {
  it('预组卡组都能用，中文规则和 validateDeck 结论一致', () => {
    for (const cls of ['demacia', 'noxus', 'ionia', 'freljord'] as const) {
      const cards = PRESET_DECKS[cls]!;
      expect(deckProblems(cards, cls)).toEqual([]);
      expect(isPlayable({ cards, heroClass: cls })).toBe(true);
    }
  });

  it('不满 30 张、超过 2 张、别的职业的卡、衍生物都有提示，且 validateDeck 也判为不合规', () => {
    const base = PRESET_DECKS.demacia!;
    const cases: [string[], RegExp][] = [
      [base.slice(0, 28), /还差 2 张/],
      [[...base.slice(0, 27), 'demacia.lux', 'demacia.lux', 'demacia.lux'], /同名最多 2 张/],
      [[...base.slice(0, 29), 'noxus.annie'], /不是德玛西亚的卡/],
    ];
    const token = allCards().find((c) => c.token && c.type === 'minion')!;
    cases.push([[...base.slice(0, 29), token.id], /衍生物/]);
    for (const [cards, msg] of cases) {
      expect(deckProblems(cards, 'demacia').join('；')).toMatch(msg);
      if (cards.length === 30) expect(validateDeck(cards, 'demacia', allCards()).length).toBeGreaterThan(0);
      expect(isPlayable({ cards, heroClass: 'demacia' })).toBe(false);
    }
  });

  it('加卡时给出原因', () => {
    expect(addProblem([], 'demacia', 'noxus.annie')).toBe('只能用德玛西亚的职业卡和中立卡');
    expect(addProblem(['demacia.lux', 'demacia.lux'], 'demacia', 'demacia.lux')).toBe('同名最多 2 张');
    expect(addProblem(PRESET_DECKS.demacia!, 'demacia', 'neutral.caster_minion')).toBe('卡组已满 30 张');
    expect(addProblem([], 'demacia', 'demacia.lux')).toBeNull();
  });

  it('卡池只有本职业和中立的可收集卡，按费用排', () => {
    const pool = poolFor('ionia');
    expect(pool.length).toBeGreaterThan(20);
    expect(pool.every((c) => (c.class === 'ionia' || c.class === 'neutral') && !c.token && c.type !== 'hero_power')).toBe(true);
    for (let i = 1; i < pool.length; i++) expect(pool[i]!.cost).toBeGreaterThanOrEqual(pool[i - 1]!.cost);
  });

  it('卡组行和法力曲线', () => {
    const rows = deckRows(PRESET_DECKS.noxus!);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(30);
    expect(rows.every((r) => r.count === 2)).toBe(true);
    const curve = manaCurve(PRESET_DECKS.noxus!);
    expect(curve).toHaveLength(8);
    expect(curve.reduce((a, b) => a + b, 0)).toBe(30);
  });
});

describe('存档', () => {
  it('新建、改名、存卡、删除都写进 localStorage，重新读回来一样', () => {
    const d = createDeck('freljord', '冰原', ['freljord.olaf']);
    saveDeckCards(d.id, ['freljord.olaf', 'freljord.olaf', 'neutral.caster_minion']);
    renameDeck(d.id, '冰原控制');
    resetDeckCache();
    const back = getDeck(d.id)!;
    expect(back.name).toBe('冰原控制');
    expect(back.cards).toEqual(['freljord.olaf', 'freljord.olaf', 'neutral.caster_minion']);
    expect(JSON.parse(store.data.get(DECKS_KEY)!).version).toBe(1);
    deleteDeck(d.id);
    resetDeckCache();
    expect(loadDecks().decks).toEqual([]);
  });

  it('卡池里没有的卡跳过并记下，坏数据和不认识的版本不报错', () => {
    const raw = serializeDecks([{ id: 'x', name: '旧卡组', heroClass: 'ionia', cards: ['ionia.zed', 'ionia.gone', 'old.card', 'ionia.gone'], updatedAt: 1 }]);
    const r = parseDecks(raw);
    expect(r.decks[0]!.cards).toEqual(['ionia.zed']);
    expect(r.dropped).toEqual([{ deck: '旧卡组', ids: ['ionia.gone', 'old.card'] }]);
    expect(parseDecks('{oops').unreadable).toBe(true);
    expect(parseDecks(JSON.stringify({ version: 99, decks: [] })).unreadable).toBe(true);
    expect(parseDecks(JSON.stringify({ version: 1, decks: [{ id: 1 }, null, { id: 'a', name: 'b', heroClass: 'void', cards: [] }] })).decks).toEqual([]);
  });

  it('读不懂的存档先备份，不被覆盖', () => {
    store.data.set(DECKS_KEY, JSON.stringify({ version: 99, decks: ['future'] }));
    expect(loadDecks().decks).toEqual([]);
    expect(store.data.get(`${DECKS_KEY}.backup`)).toContain('future');
  });

  it('存储不可用时只在本次生效', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    resetDeckCache();
    const d = createDeck('noxus', '临时');
    expect(getDeck(d.id)?.name).toBe('临时');
  });

  it('开局用的卡组：合规的自组卡组才用，否则退回预组', () => {
    const full = createDeck('noxus', '满的', PRESET_DECKS.noxus!.slice().reverse());
    const half = createDeck('noxus', '半套', PRESET_DECKS.noxus!.slice(0, 10));
    expect(deckForMatch('noxus', full.id).id).toBe(full.id);
    expect(deckForMatch('noxus', half.id).id).toBe('preset:noxus');
    expect(deckForMatch('demacia', full.id).id).toBe('preset:demacia');
    expect(deckForMatch('noxus', null).cards).toEqual(PRESET_DECKS.noxus);
  });
});

describe('改名兼容', () => {
  it('改名前的 melol.decks 还能读到，保存后只写新键、旧键不动', () => {
    const old = serializeDecks([{ id: 'old1', name: '旧档', heroClass: 'demacia', cards: [...PRESET_DECKS.demacia!], updatedAt: 1 }]);
    store.data.set('melol.decks', old);
    resetDeckCache();
    expect(loadDecks().decks.map((d) => d.id)).toEqual(['old1']);
    renameDeck('old1', '旧档改名');
    expect(JSON.parse(store.data.get(DECKS_KEY)!).decks[0].name).toBe('旧档改名');
    expect(store.data.get('melol.decks')).toBe(old);
  });
});
