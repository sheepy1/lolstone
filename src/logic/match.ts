// 逻辑模块的各个方法（docs/online.md 4.1 到 4.5）：纯函数，只调引擎、卡池和 L0、L1。
// 这里出错照常抛（引擎的缺陷在单机和测试里要看得见）；src/logic/index.ts 包一层，对平台保证不抛。
// 单机的 Table（src/server/table.ts）直接调这里，和平台的 runner 走的是同一段代码。
import { l0ChooseAction } from '../ai/l0';
import { l1ChooseAction } from '../ai/l1';
import { validateDeck } from '../cards/validate';
import { poolHash } from '../cards/poolHash';
import {
  allCards,
  applyAction,
  createGame,
  forkRng,
  maskEvents,
  maskHidden,
  other,
  type Action,
  type GameEvent,
  type GameState,
  type HeroClass,
  type Side,
} from '../engine';
import type { ForfeitReason, SetupContext, Step } from './types';
import type { BotLevel, EndReason, LogEntry, MatchResult, MatchState, Snapshot } from './state';
import { MULLIGAN_MS, nextDeadline, overdueAction } from './timeouts';
import { checkMatchActionShape, isConcede, parseSeats } from './validate';

export type MatchStep = Step<MatchState, GameEvent>;

// 开局（online.md 4.1、5.4）。先查座位 config 的形状，再核对每个人类座位交的卡池哈希，
// 都过了再用 validateDeck 查卡组：不合规的一方判负、返回一个已经结束的局面，双方都不合规算平局
export function setupMatch(ctx: SetupContext): MatchStep {
  const seed = ctx.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) return { ok: false, reason: 'malformed seed' };
  const parsed = parseSeats(ctx.seats);
  if (!parsed.ok) return parsed;
  const seats = parsed.seats;
  const hash = poolHash();
  if (seats.some((s) => s.kind === 'human' && s.poolHash !== hash)) return { ok: false, reason: 'version_mismatch' };

  const cards = allCards();
  const invalid = seats.map((s) => validateDeck(s.deck, s.heroClass, cards).length > 0);
  const bots = seats.map((s) => (s.kind === 'bot' ? s.level : null)) as [BotLevel | null, BotLevel | null];
  const classes: [HeroClass, HeroClass] = [seats[0].heroClass, seats[1].heroClass];
  if (invalid[0] || invalid[1]) {
    // 不合规的卡组可能有不存在的卡，createGame 会抛，所以换成空牌库建一个局面，直接结束
    const decks: [string[], string[]] = [invalid[0] ? [] : seats[0].deck, invalid[1] ? [] : seats[1].deck];
    const game = createGame({ seed, classes, decks }).state;
    const winner: Side | 'draw' = invalid[0] && invalid[1] ? 'draw' : invalid[0] ? 1 : 0;
    return {
      ok: true,
      state: { game: { ...game, phase: 'over', winner }, log: [], reason: 'invalid_deck', bots },
      events: [{ kind: 'game_over', group: 0, winner }],
    };
  }
  const created = createGame({ seed, classes, decks: [seats[0].deck, seats[1].deck] });
  return { ok: true, state: { game: created.state, log: [], reason: null, bots }, events: created.events, deadline: MULLIGAN_MS };
}

// 执行一个座位的动作（online.md 4.2 的校验顺序），每一步失败都返回原因、不改局面。
// seat 永远来自调用方（单机是 LocalMatch，线上是平台核对过的座位），动作里的字段不能决定是谁在行动。
export function applyMatch(state: MatchState, seat: Side, action: unknown): MatchStep {
  const game = state.game;
  if (game.phase === 'over') return { ok: false, reason: 'over' };
  const shapeError = checkMatchActionShape(action);
  if (shapeError) return { ok: false, reason: shapeError };
  if (isConcede(action)) return endMatch(state, other(seat), 'concede', { seat, action: { kind: 'concede' } });
  const a = action as Action;
  // 行动方核对（online.md 5.5 第 2 条）：引擎把 state.current 当作行动方，不核对的话对手能在你的回合替你结束回合
  if (game.phase === 'mulligan' ? a.kind !== 'mulligan' || a.player !== seat : game.current !== seat) {
    return { ok: false, reason: 'not your turn' };
  }
  return runAction(state, { seat, action: structuredClone(a) });
}

// 计时到点（online.md 4.1、5.3）：只替这个座位做它拖着的事，没有就 ok:false，平台接着问下一个座位
export function timeoutMatch(state: MatchState, seat: Side): MatchStep {
  if (state.game.phase === 'over') return { ok: false, reason: 'over' };
  const action = overdueAction(state.game, seat);
  if (!action) return { ok: false, reason: 'nothing overdue' };
  return runAction(state, { seat, action, by: 'timeout' });
}

// 平台发起的判负（online.md 4.1）：断线宽限到或运营踢人。不走引擎，对方获胜
export function forfeitMatch(state: MatchState, seat: Side, reason: ForfeitReason): MatchStep {
  if (state.game.phase === 'over') return { ok: false, reason: 'over' };
  if (reason !== 'abandon' && reason !== 'kicked') return { ok: false, reason: 'malformed forfeit reason' };
  return endMatch(state, other(seat), reason, null);
}

// 这个座位能看到的局面：maskHidden 再把 rng 置零（online.md 5.5 第 4 条：maskHidden 的派生随机数可逆）
export function maskMatch(state: MatchState, seat: Side): Snapshot {
  return { game: { ...maskHidden(state.game, seat), rng: { s: 0 } }, reason: state.reason };
}

export function maskMatchEvents(events: readonly GameEvent[], seat: Side): GameEvent[] {
  return maskEvents(events, seat);
}

export function matchResult(state: MatchState): MatchResult | null {
  const { game, reason } = state;
  if (game.phase !== 'over' || game.winner === undefined) return null;
  return { winner: game.winner, reason: reason ?? 'game' };
}

// bot 座位的下一步（online.md 5.6）：只看遮过的局面，现在没事做返回 null。
// 隔离环境没有 Math.random，随机数从真实局面的 rng 派生，再混上座位和已走的步数：同一局面每次问答案相同，
// 每走一步换一条流。派生不推进局面里的 rng，问 bot 不改变对局
export function botMatch(state: MatchState, seat: Side): Action | null {
  const level = state.bots[seat];
  if (!level || state.game.phase === 'over') return null;
  const rng = forkRng(state.game, (Math.imul(state.log.length + 1, 0x9e3779b1) ^ (0x626f7400 + seat)) >>> 0);
  const choose = level === 'L0' ? l0ChooseAction : l1ChooseAction;
  return choose(maskHidden(state.game, seat), seat, rng)?.action ?? null;
}

// 4.2 的第 4、5 步：checkAction（在 applyAction 里）和执行。log 追加一条，phase 或行动方变了带新的 deadline
function runAction(state: MatchState, entry: LogEntry & { action: Action }): MatchStep {
  const r = applyAction(state.game, entry.action);
  if (!r.ok) return { ok: false, reason: r.error };
  const next: MatchState = { ...state, game: r.state, log: [...state.log, entry], reason: r.state.phase === 'over' ? 'game' : null };
  return withDeadline({ ok: true, state: next, events: r.events }, nextDeadline(state.game, r.state));
}

// 不走引擎的结束（认输、判负）：game 换成已结束、winner 是对方，合成一条只有 game_over 的事件，和引擎分出胜负时
// 表现层收到的一样
function endMatch(state: MatchState, winner: Side, reason: EndReason, entry: LogEntry | null): MatchStep {
  const game: GameState = { ...state.game, phase: 'over', winner };
  return {
    ok: true,
    state: { ...state, game, log: entry ? [...state.log, entry] : state.log, reason },
    events: [{ kind: 'game_over', group: 0, winner }],
    deadline: null,
  };
}

// deadline 为 undefined 时不写这个字段（Step 里不带才是"保留计时器"，State 和 Step 都按纯 JSON 处理）
function withDeadline(step: MatchStep & { ok: true }, deadline: number | null | undefined): MatchStep {
  return deadline === undefined ? step : { ...step, deadline };
}
