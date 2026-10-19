// L0 随机 AI（spec 4.1）：从合法动作里均匀随机选一个，换牌阶段也一样。
// 用自己的随机数流，不消耗对局局面里的随机数。
import { listLegalActions, type Action } from '../engine/actions';
import { nextInt } from '../engine/rng';
import type { GameState, RngState, Side } from '../engine/state';

export function l0ChooseAction(state: GameState, side: Side, rng: RngState): { action: Action; rng: RngState } | null {
  const legal = listLegalActions(state, side);
  if (legal.length === 0) return null;
  const [i, next] = nextInt(rng, legal.length);
  return { action: legal[i], rng: next };
}
