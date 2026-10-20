// 计时（docs/online.md 4.1、5.3）：每一步带不带 deadline、带多少，计时到点替哪个座位做什么。
// 平台只有一个计时器：换牌阶段双方共用开局起的 60 秒，对局阶段是当前回合的 75 秒。
import type { Action, GameState, Side } from '../engine';

export const MULLIGAN_MS = 60_000;
export const TURN_MS = 75_000;

// 一步之后的 deadline：结束了清掉计时器（null）；进入对局阶段或换了行动方，开当前回合的 75 秒；
// 其余不带（undefined），平台保留正在走的计时器。所以先交换牌的一方那一步不带，共用的 60 秒照走
export function nextDeadline(before: GameState, after: GameState): number | null | undefined {
  if (after.phase === 'over') return null;
  if (before.phase !== after.phase || before.current !== after.current) return TURN_MS;
  return undefined;
}

// 计时到点时要替这个座位做的事，没有就是 null。平台按座位号依次问，只替真正拖着的那一方做：
// 换牌阶段它还没交，就替它交"一张都不换"；对局阶段正轮到它，就替它结束回合
export function overdueAction(game: GameState, seat: Side): Action | null {
  if (game.phase === 'mulligan') return game.players[seat].mulliganDone ? null : { kind: 'mulligan', player: seat, replace: [] };
  if (game.phase === 'playing' && game.current === seat) return { kind: 'end_turn' };
  return null;
}
