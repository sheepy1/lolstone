// 设置页的持久化（src/ui/settings.ts）和对局菜单的认输（Match.concede）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Match } from '../src/app/match';
import { PRESET_DECKS } from '../src/cards';
import type { Director } from '../src/presentation/director';
import type { PresentationEvent } from '../src/presentation/events';
import { getSettings, onSettingsChange, parseSettings, reloadSettings, setSettings, SETTINGS_DEFAULTS, SETTINGS_KEY } from '../src/ui/settings';

function fakeStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings', () => {
  it('只认识合法的值，坏数据按默认值', () => {
    expect(parseSettings(null)).toEqual(SETTINGS_DEFAULTS);
    expect(parseSettings('not json')).toEqual(SETTINGS_DEFAULTS);
    expect(parseSettings(JSON.stringify({ animSpeed: 3, difficulty: 'l9' }))).toEqual(SETTINGS_DEFAULTS);
    expect(parseSettings(JSON.stringify({ animSpeed: 1.5, difficulty: 'l0' }))).toEqual({ animSpeed: 1.5, difficulty: 'l0' });
  });

  it('改动写进 localStorage，重新读回来一样，并通知订阅者', () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    reloadSettings();
    const seen: number[] = [];
    const off = onSettingsChange((s) => seen.push(s.animSpeed));
    setSettings({ animSpeed: 2, difficulty: 'l0' });
    off();
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!)).toEqual({ animSpeed: 2, difficulty: 'l0' });
    expect(seen).toEqual([2]);
    expect(reloadSettings()).toEqual({ animSpeed: 2, difficulty: 'l0' });
    setSettings({ ...SETTINGS_DEFAULTS });
  });

  it('改名前的 melol.settings 还能读到，保存后写新键', () => {
    const store = fakeStorage();
    store.data.set('melol.settings', JSON.stringify({ animSpeed: 2, difficulty: 'l2' }));
    vi.stubGlobal('localStorage', store);
    expect(reloadSettings()).toEqual({ animSpeed: 2, difficulty: 'l2' });
    setSettings({ animSpeed: 1.5 });
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!)).toEqual({ animSpeed: 1.5, difficulty: 'l2' });
    expect(store.data.get('melol.settings')).toBe(JSON.stringify({ animSpeed: 2, difficulty: 'l2' }));
    setSettings({ ...SETTINGS_DEFAULTS });
  });

  it('存储不可用时只在本次生效，不抛错', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(reloadSettings()).toEqual(SETTINGS_DEFAULTS);
    expect(() => setSettings({ animSpeed: 1.5 })).not.toThrow();
    expect(getSettings().animSpeed).toBe(1.5);
    setSettings({ ...SETTINGS_DEFAULTS });
  });
});

describe('Match.concede', () => {
  it('记为对手获胜，发 game_over，之后玩家不能再行动', () => {
    const batches: PresentationEvent[][] = [];
    const director = { busy: false, enqueue: (e: PresentationEvent[]) => batches.push([...e]) } as unknown as Director;
    const match = new Match({ seed: 7, classes: ['demacia', 'noxus'], decks: [[...PRESET_DECKS.demacia!], [...PRESET_DECKS.noxus!]], human: 0 });
    match.start(director);
    expect(match.humanToAct()).toBe(true);
    match.concede();
    expect(match.over).toBe(true);
    expect(match.state.winner).toBe(1);
    expect(batches[batches.length - 1]).toEqual([{ kind: 'game_over', group: 0, winner: 1 }]);
    expect(match.humanToAct()).toBe(false);
    expect(match.legalActions()).toBeNull();
    const n = batches.length;
    match.concede();
    expect(batches.length).toBe(n);
  });
});
