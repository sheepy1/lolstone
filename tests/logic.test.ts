// 逻辑模块（docs/online.md 第 4 节、9.1、9.4）：直接调导出的 logic 对象，按平台的 runner 调它的方式核对
// setup 的三种结果、apply 的 deadline、onTimeout 按座位依次调的语义、forfeit、bot、result，以及任何输入都不抛。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_DECKS, poolHash } from '../src/cards';
import { HIDDEN_CARD_ID, listLegalActions, other, type GameEvent, type HeroClass } from '../src/engine';
import { logic, type MatchState, type Snapshot, type Step } from '../src/logic';
import type { SeatSpec } from '../src/logic/types';

type S = Step<MatchState, GameEvent>;
type Ok = Extract<S, { ok: true }>;

function human(heroClass: HeroClass, deck: string[] = [...PRESET_DECKS[heroClass]], hash = poolHash()): SeatSpec {
  return { kind: 'human', config: { heroClass, deck, poolHash: hash } };
}

function bot(level: 'L0' | 'L1', heroClass: HeroClass): SeatSpec {
  return { kind: 'bot', config: { level, heroClass } };
}

function ok(step: S): Ok {
  if (!step.ok) throw new Error(`step rejected: ${step.reason}`);
  return step;
}

function start(seed = 42, seats: SeatSpec[] = [human('demacia'), human('noxus')]): MatchState {
  return ok(logic.setup({ seed, seats, options: null })).state;
}

// 平台的一轮计时到点（协议 §2.4）：按座位号依次调，生效的各算一步，某一步带回新的 deadline 就停
function timeoutRound(state: MatchState): { state: MatchState; steps: Ok[] } {
  const steps: Ok[] = [];
  for (const seat of [0, 1]) {
    const r = logic.onTimeout(state, seat);
    if (!r.ok) continue;
    steps.push(r);
    state = r.state;
    if (typeof r.deadline === 'number') break;
  }
  return { state, steps };
}

// 双方都交"一张都不换"，进入对局阶段
function playing(seed = 42): MatchState {
  let s = start(seed);
  s = ok(logic.apply(s, 0, { kind: 'mulligan', player: 0, replace: [] })).state;
  return ok(logic.apply(s, 1, { kind: 'mulligan', player: 1, replace: [] })).state;
}

// 隔离环境里没有 Math.random：模块里任何地方调到它就让测试失败
beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Math.random is not available in the isolate');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('setup', () => {
  it('正常开局：换牌阶段、开局那批事件、60 秒的 deadline，局面是纯 JSON', () => {
    const r = ok(logic.setup({ seed: 42, seats: [human('demacia'), bot('L1', 'noxus')], options: null }));
    expect(r.state.game.phase).toBe('mulligan');
    expect(r.state.reason).toBeNull();
    expect(r.state.log).toEqual([]);
    expect(r.state.bots).toEqual([null, 'L1']);
    expect(r.events.map((e) => e.kind)).toEqual(['mulligan_start']);
    expect(r.deadline).toBe(60_000);
    expect(JSON.parse(JSON.stringify(r.state))).toEqual(r.state);
    expect(logic.result(r.state)).toBeNull();
    // 同一个 seed 开出同一局
    expect(logic.setup({ seed: 42, seats: [human('demacia'), bot('L1', 'noxus')], options: null })).toEqual(r);
  });

  it('卡池哈希不一致：ok:false version_mismatch，对局不开始', () => {
    const r = logic.setup({ seed: 1, seats: [human('demacia'), human('noxus', undefined, 'deadbeef')], options: null });
    expect(r).toEqual({ ok: false, reason: 'version_mismatch' });
  });

  it('卡组不合规：返回已经结束的局面，不合规那方判负 invalid_deck；双方都不合规是平局', () => {
    const short = PRESET_DECKS.noxus.slice(1);
    const r = ok(logic.setup({ seed: 1, seats: [human('demacia'), human('noxus', short)], options: null }));
    expect(r.state.game.phase).toBe('over');
    expect(r.events).toEqual([{ kind: 'game_over', group: 0, winner: 0 }]);
    expect(r.deadline).toBeUndefined();
    expect(logic.result(r.state)).toEqual({ winner: 0, reason: 'invalid_deck' });
    // 别的职业的牌、不存在的牌
    const foreign = [...PRESET_DECKS.demacia.slice(1), PRESET_DECKS.noxus[0]!];
    const unknown = [...PRESET_DECKS.noxus.slice(1), 'no.such.card'];
    const both = ok(logic.setup({ seed: 1, seats: [human('demacia', foreign), human('noxus', unknown)], options: null }));
    expect(logic.result(both.state)).toEqual({ winner: 'draw', reason: 'invalid_deck' });
    // 已经结束的局面上 apply、onTimeout、forfeit 都拒
    expect(logic.apply(r.state, 1, { kind: 'concede' })).toEqual({ ok: false, reason: 'over' });
    expect(logic.onTimeout(r.state, 0).ok).toBe(false);
    expect(logic.forfeit(r.state, 0, 'abandon').ok).toBe(false);
  });

  it('座位 config 的形状不对：ok:false，原因以 malformed 开头', () => {
    const bad: unknown[] = [
      [human('demacia')],
      [human('demacia'), { kind: 'human', config: { heroClass: 'noxus', deck: PRESET_DECKS.noxus } }],
      [human('demacia'), { kind: 'human', config: { heroClass: 'noxus', deck: PRESET_DECKS.noxus, poolHash: poolHash(), nickname: 'x' } }],
      [human('demacia'), { kind: 'human', config: { heroClass: 'void', deck: PRESET_DECKS.noxus, poolHash: poolHash() } }],
      [human('demacia'), { kind: 'human', config: { heroClass: 'noxus', deck: [1, 2], poolHash: poolHash() } }],
      [human('demacia'), { kind: 'bot', config: { level: 'L2', heroClass: 'noxus' } }],
      [human('demacia'), { kind: 'spectator', config: {} }],
      [human('demacia'), null],
      'two seats',
    ];
    for (const seats of bad) {
      const r = logic.setup({ seed: 1, seats: seats as SeatSpec[], options: null });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/^malformed/);
    }
    expect(logic.setup({ seed: -1, seats: [human('demacia'), human('noxus')], options: null })).toEqual({ ok: false, reason: 'malformed seed' });
  });
});

describe('apply', () => {
  it('deadline：先交换牌的一方不带，进入对局阶段带 75 秒；行动方不变时不带，换人带 75 秒；结束清掉', () => {
    let s = start();
    const first = logic.apply(s, 1, { kind: 'mulligan', player: 1, replace: [0] });
    expect(ok(first)).not.toHaveProperty('deadline');
    s = ok(first).state;
    const second = ok(logic.apply(s, 0, { kind: 'mulligan', player: 0, replace: [] }));
    expect(second.deadline).toBe(75_000);
    s = second.state;
    const current = s.game.current;
    // 不换人的动作（出牌、攻击、英雄技能）不带 deadline。先手第一回合可能什么都做不了，就跳过这段
    const act = listLegalActions(s.game, current).find((a) => a.kind !== 'end_turn');
    if (act) {
      const play = ok(logic.apply(s, current, act));
      expect(play).not.toHaveProperty('deadline');
      s = play.state;
    }
    const end = ok(logic.apply(s, current, { kind: 'end_turn' }));
    expect(end.deadline).toBe(75_000);
    expect(end.state.game.current).toBe(other(current));
    const concede = ok(logic.apply(end.state, current, { kind: 'concede' }));
    expect(concede.deadline).toBeNull();
    expect(concede.events).toEqual([{ kind: 'game_over', group: 0, winner: other(current) }]);
    expect(logic.result(concede.state)).toEqual({ winner: other(current), reason: 'concede' });
  });

  it('不改入参；拒绝的动作原因照 4.2 的顺序，局面不变', () => {
    const s = playing();
    const before = structuredClone(s);
    const current = s.game.current;
    const cases: [number, unknown, RegExp][] = [
      [other(current), { kind: 'end_turn' }, /^not your turn$/],
      [current, { kind: 'mulligan', player: current, replace: [] }, /^mulligan phase is over$/],
      [current, { kind: 'play_card', handIndex: '0' }, /^malformed action/],
      [current, { kind: 'play_card', handIndex: -1 }, /^malformed action/],
      [current, { kind: 'play_card', handIndex: 0.5 }, /^malformed action/],
      [current, { kind: 'play_card', handIndex: NaN }, /^malformed action/],
      [current, { kind: 'end_turn', side: current }, /^malformed action/],
      [current, { kind: 'concede', why: 1 }, /^malformed action/],
      [current, 'end_turn', /^malformed action/],
      [current, null, /^malformed action/],
      [current, { kind: 'play_card', handIndex: 99 }, /^no card at hand index/],
      [2, { kind: 'end_turn' }, /^bad seat$/],
      [-1, { kind: 'end_turn' }, /^bad seat$/],
    ];
    for (const [seat, action, reason] of cases) {
      const r = logic.apply(s, seat, action);
      expect(r.ok, JSON.stringify(action)).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
      expect(s).toEqual(before);
    }
    ok(logic.apply(s, current, { kind: 'end_turn' }));
    expect(s).toEqual(before);
  });
});

describe('onTimeout：平台按座位号依次调', () => {
  it('换牌阶段：0 号和 1 号都没交，各自替交"一张都不换"，第二步进入对局阶段带回 75 秒', () => {
    const s = start();
    const round = timeoutRound(s);
    expect(round.steps).toHaveLength(2);
    expect(round.steps[0]).not.toHaveProperty('deadline');
    expect(round.steps[1]!.deadline).toBe(75_000);
    expect(round.state.game.phase).toBe('playing');
    expect(round.state.log).toEqual([
      { seat: 0, action: { kind: 'mulligan', player: 0, replace: [] }, by: 'timeout' },
      { seat: 1, action: { kind: 'mulligan', player: 1, replace: [] }, by: 'timeout' },
    ]);
  });

  it('换牌阶段：已经交了的座位返回 ok:false，只替没交的一方', () => {
    let s = start();
    s = ok(logic.apply(s, 0, { kind: 'mulligan', player: 0, replace: [1] })).state;
    expect(logic.onTimeout(s, 0).ok).toBe(false);
    const round = timeoutRound(s);
    expect(round.steps).toHaveLength(1);
    expect(round.state.log[1]).toEqual({ seat: 1, action: { kind: 'mulligan', player: 1, replace: [] }, by: 'timeout' });
  });

  it('对局阶段：只有当前方生效，替它结束回合后这一轮就停，不会接着替对方结束回合', () => {
    const s = playing();
    const current = s.game.current;
    expect(logic.onTimeout(s, other(current)).ok).toBe(false);
    const round = timeoutRound(s);
    expect(round.steps).toHaveLength(1);
    expect(round.steps[0]!.deadline).toBe(75_000);
    expect(round.state.game.current).toBe(other(current));
    expect(round.state.log[round.state.log.length - 1]).toEqual({ seat: current, action: { kind: 'end_turn' }, by: 'timeout' });
  });
});

describe('forfeit', () => {
  it('断线判负和踢人：不走引擎，对方获胜，原因照填，只合成一条 game_over', () => {
    const s = playing();
    for (const reason of ['abandon', 'kicked'] as const) {
      const r = ok(logic.forfeit(s, 0, reason));
      expect(r.events).toEqual([{ kind: 'game_over', group: 0, winner: 1 }]);
      expect(r.deadline).toBeNull();
      expect(r.state.game.phase).toBe('over');
      expect(r.state.log).toEqual(s.log);
      expect(logic.result(r.state)).toEqual({ winner: 1, reason });
      const snap = logic.mask(r.state, 1) as Snapshot;
      expect(snap.reason).toBe(reason);
    }
    expect(logic.forfeit(s, 0, 'bored' as never)).toEqual({ ok: false, reason: 'malformed forfeit reason' });
    // 换牌阶段也能判
    expect(logic.result(ok(logic.forfeit(start(), 1, 'abandon')).state)).toEqual({ winner: 0, reason: 'abandon' });
  });
});

describe('mask、maskEvents', () => {
  it('快照只有遮过的 game 和 reason：rng 置零，对手手牌和双方牌库是占位牌，没有 log 和 bots', () => {
    const s = start(7, [human('demacia'), bot('L0', 'noxus')]);
    const step = ok(logic.apply(s, 0, { kind: 'mulligan', player: 0, replace: [] }));
    for (const seat of [0, 1] as const) {
      const snap = logic.mask(step.state, seat) as Snapshot;
      expect(Object.keys(snap).sort()).toEqual(['game', 'reason']);
      expect(snap.game.rng).toEqual({ s: 0 });
      expect(snap.game.players[other(seat)].hand.every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
      for (const p of snap.game.players) expect(p.deck.every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
      expect(snap.game.players[other(seat)].mulliganReplace ?? []).toEqual([]);
    }
    const opening = ok(logic.setup({ seed: 7, seats: [human('demacia'), human('noxus')], options: null })).events;
    const seen = logic.maskEvents(opening, 0)[0] as Extract<GameEvent, { kind: 'mulligan_start' }>;
    expect(seen.hands[1].every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
    expect(seen.hands[0].some((c) => c.cardId === HIDDEN_CARD_ID)).toBe(false);
  });
});

describe('bot', () => {
  it('两个 bot 座位（L0 对 L1）只靠 bot 和 apply 打完一局；同一局面答案相同；不是 bot 的座位和没事做时返回 null', () => {
    let s = ok(logic.setup({ seed: 3, seats: [bot('L0', 'ionia'), bot('L1', 'freljord')], options: null })).state;
    let steps = 0;
    while (!logic.result(s) && steps < 400) {
      let acted = false;
      for (const seat of [0, 1]) {
        const action = logic.bot(s, seat);
        if (action === null) continue;
        expect(logic.bot(s, seat)).toEqual(action);
        s = ok(logic.apply(s, seat, action)).state;
        steps++;
        acted = true;
        break;
      }
      expect(acted, '两个 bot 都没事做').toBe(true);
    }
    const result = logic.result(s);
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(['reason', 'winner']);
    expect(result!.reason).toBe('game');
    expect(s.log).toHaveLength(steps);
    expect(logic.bot(s, 0)).toBeNull();

    const p = playing();
    expect(logic.bot(p, 0)).toBeNull();
    const withBot = start(5, [human('demacia'), bot('L1', 'noxus')]);
    expect(logic.bot(withBot, 0)).toBeNull();
    expect(logic.bot(withBot, 1)).toMatchObject({ kind: 'mulligan', player: 1 });
  });
});

describe('result', () => {
  it('没结束为 null；结束了只有 winner 和 reason', () => {
    expect(logic.result(playing())).toBeNull();
    const done = ok(logic.apply(playing(), 0, { kind: 'concede' })).state;
    expect(logic.result(done)).toEqual({ winner: 1, reason: 'concede' });
  });
});

describe('任何输入都不抛', () => {
  it('局面、座位、事件是垃圾时返回拒绝或空结果', () => {
    const garbage: unknown[] = [null, undefined, 0, 'x', [], {}, { game: null }, { game: { phase: 'playing' } }];
    for (const g of garbage) {
      const state = g as MatchState;
      expect(() => logic.apply(state, 0, { kind: 'end_turn' })).not.toThrow();
      expect(logic.apply(state, 0, { kind: 'end_turn' }).ok).toBe(false);
      expect(logic.onTimeout(state, 0).ok).toBe(false);
      expect(() => logic.forfeit(state, 0, 'abandon')).not.toThrow();
      expect(() => logic.mask(state, 0)).not.toThrow();
      expect(() => logic.result(state)).not.toThrow();
      expect(() => logic.bot(state, 0)).not.toThrow();
      expect(logic.maskEvents(g as GameEvent[], 0)).toEqual(expect.any(Array));
      expect(logic.setup(g as never).ok).toBe(false);
    }
    expect(logic.mask(playing(), 5)).toBeNull();
    expect(logic.maskEvents([], 5)).toEqual([]);
  });
});
