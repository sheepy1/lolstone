// 开局和换牌（spec 2.1、2.2、6.5）。
import { describe, expect, it } from 'vitest';
import { PRESET_DECKS } from '../src/cards';
import { applyAction, createGame, listLegalActions, MANA_POTION_ID, type GameState, type Side } from '../src/engine';

const decks = (): [string[], string[]] => [[...PRESET_DECKS.demacia!], [...PRESET_DECKS.freljord!]];

function newGame(seed = 1, first?: Side) {
  return createGame({ seed, classes: ['demacia', 'freljord'], decks: decks(), first });
}

function mulligan(state: GameState, player: Side, replace: number[]): GameState {
  const r = applyAction(state, { kind: 'mulligan', player, replace });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('开局', () => {
  it('先手 3 张，后手 4 张加一张法力药水，双方 30 点生命', () => {
    const { state, events } = newGame(1, 0);
    expect(state.phase).toBe('mulligan');
    expect(state.turn).toBe(0);
    expect(state.players[0].hand).toHaveLength(3);
    expect(state.players[1].hand).toHaveLength(5);
    expect(state.players[1].hand[4].cardId).toBe(MANA_POTION_ID);
    expect(state.players[0].hand.some((c) => c.cardId === MANA_POTION_ID)).toBe(false);
    expect(state.players[0].deck).toHaveLength(27);
    expect(state.players[1].deck).toHaveLength(26);
    expect(state.players.map((p) => p.hero.health)).toEqual([30, 30]);
    expect(events.map((e) => e.kind)).toEqual(['mulligan_start']);
  });

  it('不指定先手时随机决定，同一种子结果相同', () => {
    const firsts = new Set<number>();
    for (let seed = 0; seed < 20; seed++) firsts.add(newGame(seed).state.current);
    expect(firsts.size).toBe(2);
    expect(newGame(7).state).toEqual(newGame(7).state);
  });

  it('换牌阶段只有 mulligan 合法', () => {
    const { state } = newGame(1, 0);
    expect(listLegalActions(state, 0).every((a) => a.kind === 'mulligan')).toBe(true);
    expect(applyAction(state, { kind: 'end_turn' }).ok).toBe(false);
  });

  it('skipMulligan 直接进入第一回合', () => {
    const { state, events } = createGame({ seed: 1, classes: ['demacia', 'freljord'], decks: decks(), first: 0, skipMulligan: true });
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(1);
    expect(state.players[0].hand).toHaveLength(4);
    expect(events.map((e) => e.kind)).toContain('game_start');
  });
});

describe('换牌', () => {
  it('一张都不换：手牌不变，双方提交后开始先手的第一回合', () => {
    const { state } = newGame(2, 0);
    let s = mulligan(state, 0, []);
    expect(s.phase).toBe('mulligan');
    expect(s.players[0].hand).toEqual(state.players[0].hand);
    expect(listLegalActions(s, 0)).toEqual([]);
    const r = applyAction(s, { kind: 'mulligan', player: 1, replace: [] });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.phase).toBe('playing');
    expect(s.turn).toBe(1);
    expect(s.current).toBe(0);
    expect(s.players[0].hand.slice(0, 3)).toEqual(state.players[0].hand);
    expect(s.players[0].hand).toHaveLength(4); // 第一回合抽了一张
    expect(r.events.map((e) => e.kind).slice(0, 4)).toEqual(['mulligan_done', 'mulligan_done', 'game_start', 'turn_start']);
  });

  it('换全部：换掉的牌洗回牌库，补抽同样张数，牌库张数不变', () => {
    const { state } = newGame(3, 0);
    let s = mulligan(state, 1, []);
    const r = applyAction(s, { kind: 'mulligan', player: 0, replace: [0, 1, 2] });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    const done = r.events.find((e) => e.kind === 'mulligan_done' && e.side === 0);
    expect(done && done.kind === 'mulligan_done' && done.replaced).toEqual(state.players[0].hand);
    expect(done && done.kind === 'mulligan_done' && done.drawn).toHaveLength(3);
    expect(s.players[0].deck).toHaveLength(26); // 27 张，第一回合抽 1
    const allIds = [...s.players[0].deck, ...s.players[0].hand].map((c) => c.instanceId).sort((a, b) => a - b);
    const before = [...state.players[0].deck, ...state.players[0].hand].map((c) => c.instanceId).sort((a, b) => a - b);
    expect(allIds).toEqual(before);
  });

  it('新牌放回被换掉的位置', () => {
    const { state } = newGame(4, 0);
    const s = mulligan(mulligan(state, 0, [1]), 1, []);
    expect(s.players[0].hand[0]).toEqual(state.players[0].hand[0]);
    expect(s.players[0].hand[2]).toEqual(state.players[0].hand[2]);
  });

  it('法力药水不能换', () => {
    const { state } = newGame(5, 0);
    const options = listLegalActions(state, 1);
    expect(options).toHaveLength(16); // 4 张能换的牌的所有子集
    expect(options.some((a) => a.kind === 'mulligan' && a.replace.includes(4))).toBe(false);
    expect(applyAction(state, { kind: 'mulligan', player: 1, replace: [4] }).ok).toBe(false);
    const s = mulligan(mulligan(state, 1, [0, 1, 2, 3]), 0, []);
    expect(s.players[1].hand.some((c) => c.cardId === MANA_POTION_ID)).toBe(true);
  });

  it('每方只能提交一次；下标重复或越界是非法动作', () => {
    const { state } = newGame(6, 0);
    const s = mulligan(state, 0, [0]);
    expect(applyAction(s, { kind: 'mulligan', player: 0, replace: [] }).ok).toBe(false);
    expect(applyAction(state, { kind: 'mulligan', player: 0, replace: [0, 0] }).ok).toBe(false);
    expect(applyAction(state, { kind: 'mulligan', player: 0, replace: [3] }).ok).toBe(false);
  });

  it('双方提交顺序不影响结果', () => {
    for (const seed of [10, 11, 12]) {
      const { state } = newGame(seed);
      const a = mulligan(mulligan(state, 0, [0, 2]), 1, [1, 2]);
      const b = mulligan(mulligan(state, 1, [1, 2]), 0, [0, 2]);
      expect(a).toEqual(b);
    }
  });
});
