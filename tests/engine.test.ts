// 引擎约束（spec 6.3、6.5、4.5）：纯函数、确定性、非法动作返回错误、局面可 JSON 序列化、
// listLegalActions 列出的动作一定能执行、maskHidden、forkRng、不变量检查。
import { describe, expect, it } from 'vitest';
import { l0ChooseAction } from '../src/ai/l0';
import { PRESET_DECKS } from '../src/cards';
import {
  applyAction,
  createGame,
  findInvariantViolations,
  forkRng,
  HIDDEN_CARD_ID,
  listLegalActions,
  maskHidden,
  nextFloat,
  seedRng,
  type Action,
  type GameEvent,
  type GameState,
  type Side,
} from '../src/engine';
import { scenario } from './helpers/scenario';

const decks = (): [string[], string[]] => [[...PRESET_DECKS.demacia!], [...PRESET_DECKS.freljord!]];

// 用 L0 打一局，记下每一步的局面和动作。
function recordGame(seed: number): { states: GameState[]; actions: Action[]; events: GameEvent[][] } {
  let state = createGame({ seed, classes: ['demacia', 'freljord'], decks: decks() }).state;
  let rng = seedRng(seed + 99);
  const states = [state];
  const actions: Action[] = [];
  const events: GameEvent[][] = [];
  while (state.phase !== 'over') {
    const side: Side = state.phase === 'mulligan' ? (state.players[0].mulliganDone ? 1 : 0) : state.current;
    const choice = l0ChooseAction(state, side, rng)!;
    rng = choice.rng;
    const r = applyAction(state, choice.action);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
    states.push(state);
    actions.push(choice.action);
    events.push(r.events);
  }
  return { states, actions, events };
}

describe('纯函数与确定性', () => {
  it('applyAction 不改入参', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['虚空幼虫']).hand(0, ['审判']).build();
    const snapshot = structuredClone(g.state);
    applyAction(g.state, { kind: 'attack', attacker: g.m(0, '魔狼'), target: g.m(1, '虚空幼虫') });
    applyAction(g.state, g.playAction('审判'));
    applyAction(g.state, { kind: 'end_turn' });
    expect(g.state).toEqual(snapshot);
  });

  it('同一个种子加同一串动作，得到同一个结果', () => {
    const a = recordGame(42);
    let state = createGame({ seed: 42, classes: ['demacia', 'freljord'], decks: decks() }).state;
    a.actions.forEach((action, i) => {
      const r = applyAction(state, action);
      if (!r.ok) throw new Error(r.error);
      expect(r.events).toEqual(a.events[i]);
      state = r.state;
    });
    expect(state).toEqual(a.states[a.states.length - 1]);
  });

  it('局面是纯 JSON：序列化再解析后继续执行，结果相同', () => {
    const a = recordGame(43);
    const mid = Math.floor(a.actions.length / 2);
    let fromJson: GameState = JSON.parse(JSON.stringify(a.states[mid]));
    for (let i = mid; i < a.actions.length; i++) {
      const r = applyAction(fromJson, a.actions[i]);
      if (!r.ok) throw new Error(r.error);
      expect(r.events).toEqual(a.events[i]);
      fromJson = r.state;
    }
    expect(JSON.parse(JSON.stringify(fromJson))).toEqual(JSON.parse(JSON.stringify(a.states[a.states.length - 1])));
  });

  it('事件也能 JSON 序列化', () => {
    const a = recordGame(44);
    const all = a.events.flat();
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
  });
});

describe('合法性', () => {
  it('listLegalActions 列出来的动作，applyAction 一定能执行（随机局面抽查）', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { states } = recordGame(seed);
      for (const state of states.filter((_, i) => i % 3 === 0)) {
        for (const side of [0, 1] as const) {
          for (const action of listLegalActions(state, side)) {
            const r = applyAction(state, action);
            expect(r.ok, JSON.stringify(action)).toBe(true);
          }
        }
      }
    }
  });

  it('非法和畸形的动作返回错误，不抛异常', () => {
    const g = scenario().board(0, ['魔狼']).build();
    const bad: unknown[] = [
      { kind: 'attack', attacker: g.hero(0), target: g.hero(1) },
      { kind: 'attack', attacker: { side: 0, kind: 'minion', instanceId: 9999 }, target: g.hero(1) },
      { kind: 'play_card', handIndex: -1 },
      { kind: 'hero_power', target: g.hero(1) },
      { kind: 'mulligan', player: 0, replace: [] },
      { kind: 'mulligan', player: 5, replace: [] },
      { kind: 'mulligan', player: 0, replace: null },
      { kind: 'fly' },
      {},
    ];
    for (const action of bad) {
      const r = applyAction(g.state, action as Action);
      expect(r.ok, JSON.stringify(action)).toBe(false);
    }
  });
});

describe('maskHidden 与 forkRng', () => {
  it('遮掉对方手牌和双方牌库，自己的手牌和场面可见', () => {
    const { state } = createGame({ seed: 1, classes: ['demacia', 'freljord'], decks: decks(), first: 0, skipMulligan: true });
    const masked = maskHidden(state, 0);
    expect(masked.players[0].hand).toEqual(state.players[0].hand);
    expect(masked.players[1].hand.every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
    expect(masked.players[1].hand.map((c) => c.instanceId)).toEqual(state.players[1].hand.map((c) => c.instanceId));
    expect(masked.players.every((p) => p.deck.every((c) => c.cardId === HIDDEN_CARD_ID))).toBe(true);
    expect(masked.rng).not.toEqual(state.rng);
    expect(state.players[1].hand.some((c) => c.cardId === HIDDEN_CARD_ID)).toBe(false); // 入参不变
  });

  it('遮过的局面可以继续模拟：占位牌不能打出，抽到占位牌也不出错', () => {
    const { state } = createGame({ seed: 2, classes: ['demacia', 'freljord'], decks: decks(), first: 0, skipMulligan: true });
    let masked = maskHidden(state, 0);
    for (let i = 0; i < 6; i++) {
      const legal = listLegalActions(masked, masked.current);
      expect(legal.some((a) => a.kind === 'play_card' && masked.players[masked.current].hand[a.handIndex].cardId === HIDDEN_CARD_ID)).toBe(false);
      const r = applyAction(masked, { kind: 'end_turn' });
      if (!r.ok) throw new Error(r.error);
      masked = r.state;
    }
  });

  it('forkRng 不推进局面里的随机数，同一局面同一 salt 得到同一条流，不同 salt 不同', () => {
    const { state } = createGame({ seed: 3, classes: ['demacia', 'freljord'], decks: decks() });
    const before = structuredClone(state.rng);
    const a = forkRng(state, 1);
    expect(state.rng).toEqual(before);
    expect(forkRng(state, 1)).toEqual(a);
    expect(forkRng(state, 2)).not.toEqual(a);
    expect(a).not.toEqual(state.rng);
    expect(nextFloat(a)[0]).not.toEqual(nextFloat(state.rng)[0]);
  });
});

describe('不变量检查', () => {
  it('能发现违反的局面', () => {
    const g = scenario().board(0, Array(7).fill('近战小兵')).build();
    const bad = structuredClone(g.state);
    bad.players[0].board.push({ ...bad.players[0].board[0], instanceId: 777 });
    bad.players[1].hero.health = 31;
    bad.players[0].mana.current = 11;
    const errors = findInvariantViolations(bad);
    expect(errors.some((e) => e.includes('board has 8'))).toBe(true);
    expect(errors.some((e) => e.includes('hero health'))).toBe(true);
    expect(errors.some((e) => e.includes('mana current'))).toBe(true);
    expect(findInvariantViolations(g.state)).toEqual([]);
  });
});
