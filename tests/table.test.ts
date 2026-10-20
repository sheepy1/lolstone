// 权威对局 Table（docs/online.md 5.2、9.1）：两个假座位打完一局，核对 version、动作日志、遮蔽和校验；
// AI 座位走和真人一样的 submit。
import { describe, expect, it, vi } from 'vitest';
import { l0ChooseAction } from '../src/ai/l0';
import { l1ChooseAction } from '../src/ai/l1';
import { PRESET_DECKS } from '../src/cards';
import { HIDDEN_CARD_ID, listLegalActions, other, seedRng, type Action, type GameEvent, type HeroClass, type Side } from '../src/engine';
import type { PresentationEvent } from '../src/presentation/events';
import { Table, type AiChooser, type Batch, type Seat } from '../src/server/table';

const CLASSES: [HeroClass, HeroClass] = ['demacia', 'noxus'];
const DECKS: [string[], string[]] = [[...PRESET_DECKS.demacia!], [...PRESET_DECKS.noxus!]];

type Inbox = Batch[];

function humanSeat(inbox: Inbox): Seat {
  return { kind: 'human', deliver: (b) => inbox.push(structuredClone(b)) };
}

function aiSeat(choose: AiChooser = l1ChooseAction, seed = 1): Seat {
  return { kind: 'ai', choose, rng: seedRng(seed) };
}

function table(seats: [Seat, Seat], seed = 42): Table {
  return new Table({ seed, classes: CLASSES, decks: DECKS, seats, thinkSeconds: 0.5, now: () => 1000 });
}

// 一个座位收到的东西都是遮过的：对手手牌、双方牌库是占位牌，rng 置零，快照里没有动作日志；事件里对手抽到、换到的牌也是占位牌
function expectMasked(batch: Batch, seat: Side): void {
  const opp = other(seat);
  const g = batch.snapshot.game;
  expect(g.rng).toEqual({ s: 0 });
  expect(Object.keys(batch.snapshot).sort()).toEqual(['game', 'reason']);
  expect(g.players[opp].hand.every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
  for (const p of g.players) expect(p.deck.every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
  expect(g.players[seat].hand.some((c) => c.cardId === HIDDEN_CARD_ID)).toBe(false);
  for (const e of batch.events as GameEvent[]) {
    if (e.kind === 'draw' && e.side === opp) expect(e.card.cardId).toBe(HIDDEN_CARD_ID);
    if (e.kind === 'mulligan_start') expect(e.hands[opp].every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
    if (e.kind === 'mulligan_done' && e.side === opp) {
      expect([...e.replaced, ...e.drawn].every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
    }
  }
}

// 用这个座位最近收到的快照选一个 L0 动作；不轮到它时为 null
function pick(inbox: Inbox, seat: Side, rng: { s: number }): { action: Action; rng: { s: number } } | null {
  const last = inbox[inbox.length - 1];
  if (!last || listLegalActions(last.snapshot.game, seat).length === 0) return null;
  return l0ChooseAction(last.snapshot.game, seat, rng);
}

describe('Table：两个真人座位', () => {
  it('打完一局：version 逐个加一，动作日志一条不差，每方只看到遮过的东西，换牌双方各自提交', () => {
    const inbox: [Inbox, Inbox] = [[], []];
    const t = table([humanSeat(inbox[0]), humanSeat(inbox[1])]);
    t.start();
    expect(t.version).toBe(0);
    expect(inbox[0]).toHaveLength(1);
    expect(inbox[0][0].events[0]!.kind).toBe('mulligan_start');

    const rng: [{ s: number }, { s: number }] = [seedRng(1), seedRng(2)];
    const submitted: { seat: Side; action: Action }[] = [];
    let mulligans = 0;
    for (let i = 0; i < 400 && !t.result(); i++) {
      const seat = ([0, 1] as const).find((s) => pick(inbox[s], s, rng[s]))!;
      expect(seat, '没有一方能行动').toBeDefined();
      const choice = pick(inbox[seat], seat, rng[seat])!;
      rng[seat] = choice.rng;
      if (choice.action.kind === 'mulligan') mulligans++;
      const version = inbox[seat][inbox[seat].length - 1]!.version;
      expect(t.submit(seat, version, choice.action)).toEqual({ ok: true });
      submitted.push({ seat, action: choice.action });
      expect(t.version).toBe(version + 1);
      // 双方都收到这一批，version 是新的
      for (const s of [0, 1] as const) expect(inbox[s][inbox[s].length - 1]!.version).toBe(t.version);
    }
    expect(t.result()).toEqual({ winner: expect.anything(), reason: 'game' });
    expect(mulligans).toBe(2);
    expect(t.version).toBe(submitted.length);
    expect(t.state.log).toEqual(submitted.map((x) => ({ ...x, at: 1000 })));
    for (const s of [0, 1] as const) {
      expect(inbox[s]).toHaveLength(submitted.length + 1);
      for (const b of inbox[s]) expectMasked(b, s);
      expect(inbox[s][inbox[s].length - 1]!.snapshot.reason).toBe('game');
    }
    // 结束后再交动作拒 'over'
    expect(t.submit(0, t.version, { kind: 'end_turn' })).toEqual({ ok: false, reason: 'over' });
  });

  it('拒绝 stale version、不是自己的回合、字段不对的动作，局面和 version 都不变', () => {
    const inbox: [Inbox, Inbox] = [[], []];
    const t = table([humanSeat(inbox[0]), humanSeat(inbox[1])]);
    t.start();
    const before = structuredClone(t.state);
    const reject = (seat: Side, version: number, action: unknown, reason: RegExp) => {
      const r = t.submit(seat, version, action);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
      expect(t.state).toEqual(before);
      expect(t.version).toBe(0);
    };
    // 换牌阶段：不能替对方换牌，也不能发别的动作
    reject(1, 0, { kind: 'mulligan', player: 0, replace: [] }, /^not your turn$/);
    reject(0, 0, { kind: 'end_turn' }, /^not your turn$/);
    reject(0, 1, { kind: 'mulligan', player: 0, replace: [] }, /^stale$/);
    reject(0, 0, { kind: 'mulligan', player: 0, replace: ['0'] }, /^malformed action/);
    reject(0, 0, { kind: 'mulligan', player: 0, replace: [], extra: true }, /^malformed action/);
    reject(0, 0, 'mulligan', /^malformed action/);
    reject(0, 0, { kind: 'concede', why: 'x' }, /^malformed action/);

    expect(t.submit(0, 0, { kind: 'mulligan', player: 0, replace: [] }).ok).toBe(true);
    expect(t.submit(1, 1, { kind: 'mulligan', player: 1, replace: [] }).ok).toBe(true);
    const current = t.state.game.current;
    const after = structuredClone(t.state);
    // 对局阶段：对手在你的回合发 end_turn 被拒（online.md 5.5 第 2 条）
    const r = t.submit(other(current), 2, { kind: 'end_turn' });
    expect(r).toEqual({ ok: false, reason: 'not your turn' });
    expect(t.state).toEqual(after);
    // handIndex 传字符串 "0" 被拒（online.md 2.3 第三项）
    const bad = t.submit(current, 2, { kind: 'play_card', handIndex: '0' });
    expect(bad.ok).toBe(false);
    expect(t.state).toEqual(after);
    expect(t.version).toBe(2);
  });

  it('认输：不在自己的回合也能认输，对手获胜，双方都收到只有 game_over 的一批', () => {
    const inbox: [Inbox, Inbox] = [[], []];
    const t = table([humanSeat(inbox[0]), humanSeat(inbox[1])]);
    t.start();
    t.submit(0, 0, { kind: 'mulligan', player: 0, replace: [] });
    t.submit(1, 1, { kind: 'mulligan', player: 1, replace: [] });
    const loser = other(t.state.game.current);
    expect(t.submit(loser, 2, { kind: 'concede' })).toEqual({ ok: true });
    expect(t.result()).toEqual({ winner: other(loser), reason: 'concede' });
    expect(t.state.log[t.state.log.length - 1]).toEqual({ seat: loser, action: { kind: 'concede' }, at: 1000 });
    for (const s of [0, 1] as const) {
      const last = inbox[s][inbox[s].length - 1]!;
      expect(last.events).toEqual([{ kind: 'game_over', group: 0, winner: other(loser) }]);
      expect(last.snapshot.reason).toBe('concede');
      expect(last.version).toBe(3);
    }
  });

  it('计时钩子还没实现：deadline 一直为 null，batch 的 deadlineIn 为 null', () => {
    const inbox: Inbox = [];
    const t = table([humanSeat(inbox), humanSeat([])]);
    t.start();
    expect(t.deadline).toBeNull();
    expect(inbox[0]!.deadlineIn).toBeNull();
    expect(() => t.timeout()).toThrow(/not implemented/);
  });
});

describe('Table：AI 座位', () => {
  it('两个 AI 座位在 start 里打完一局，每一步都走 submit', () => {
    const t = table([aiSeat(l1ChooseAction, 1), aiSeat(l0ChooseAction, 2)], 7);
    const submit = vi.spyOn(t, 'submit');
    t.start();
    expect(t.result()?.reason).toBe('game');
    expect(submit).toHaveBeenCalledTimes(t.version);
    expect(t.state.log).toHaveLength(t.version);
    expect(new Set(t.state.log.map((e) => e.seat))).toEqual(new Set([0, 1]));
    submit.mock.calls.forEach(([seat, version], i) => {
      expect(version).toBe(i);
      expect(t.state.log[i]!.seat).toBe(seat);
    });
  });

  it('真人对 AI：AI 只看遮过的局面，它的每个对局阶段动作前真人座位先收到一个 ai_thinking', () => {
    const inbox: Inbox = [];
    const seen: { hidden: boolean }[] = [];
    const choose: AiChooser = (state, side, rng) => {
      seen.push({ hidden: state.players[other(side)].hand.every((c) => c.cardId === HIDDEN_CARD_ID) });
      return l1ChooseAction(state, side, rng);
    };
    const t = table([humanSeat(inbox), aiSeat(choose)], 11);
    const submit = vi.spyOn(t, 'submit');
    t.start();
    let rng = seedRng(3);
    for (let i = 0; i < 400 && !t.result(); i++) {
      const choice = pick(inbox, 0, rng);
      expect(choice, '轮不到真人').not.toBeNull();
      rng = choice!.rng;
      expect(t.submit(0, t.version, choice!.action)).toEqual({ ok: true });
    }
    expect(t.result()).not.toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x.hidden)).toBe(true);
    // AI 的动作走同一个 submit，座位是 1
    const aiCalls = submit.mock.calls.filter(([seat]) => seat === 1);
    expect(aiCalls.length).toBe(t.state.log.filter((e) => e.seat === 1).length);
    // ai_thinking 单独成批、version 不变，紧跟着的那批 version 加一
    const events = inbox.map((b) => b.events);
    let thinks = 0;
    inbox.forEach((b, i) => {
      if (b.events[0]?.kind !== 'ai_thinking') return;
      thinks++;
      expect(b.events).toHaveLength(1);
      expect((b.events[0] as Extract<PresentationEvent, { kind: 'ai_thinking' }>).seconds).toBeGreaterThan(0);
      expect(inbox[i + 1]!.version).toBe(b.version + 1);
    });
    const aiPlaying = t.state.log.filter((e) => e.seat === 1 && e.action.kind !== 'mulligan').length;
    expect(thinks).toBe(aiPlaying);
    expect(events.flat().some((e) => e.kind === 'game_over')).toBe(true);
  });

  it('异步 AI：等它算完再执行；stop 之后回来的结果丢掉', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const inbox: Inbox = [];
    const choose: AiChooser = async (state, side, rng) => {
      await tick();
      return l1ChooseAction(state, side, rng);
    };
    const t = table([humanSeat(inbox), aiSeat(choose)], 5);
    t.start();
    expect(t.state.game.players[1].mulliganDone).toBe(false);
    await tick();
    await tick();
    expect(t.state.game.players[1].mulliganDone).toBe(true);
    expect(t.submit(0, t.version, { kind: 'mulligan', player: 0, replace: [] })).toEqual({ ok: true });
    if (t.state.game.current === 0) t.submit(0, t.version, { kind: 'end_turn' });
    // 现在轮到 AI，它还在算；离开这一局
    const version = t.version;
    const delivered = inbox.length;
    t.stop();
    for (let i = 0; i < 5; i++) await tick();
    expect(t.version).toBe(version);
    expect(inbox.length).toBe(delivered);
  });
});
