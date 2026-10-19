// 引擎入口：applyAction（spec 4.5、6.3）。
import { checkAction, type Action } from './actions';
import { GameOverSignal, makeCtx } from './context';
import type { GameEvent } from './events';
import { assertInvariants, invariantChecksEnabled } from './invariants';
import { attack, playCard, resolveDeaths, useHeroPower } from './resolve';
import { submitMulligan } from './setup';
import type { GameState } from './state';
import { endTurn } from './turn';

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };

// 纯函数：返回新局面和事件列表，不改入参。非法动作返回错误，不抛异常。
export function applyAction(state: GameState, action: Action): ApplyResult {
  const error = checkAction(state, action);
  if (error) return { ok: false, error };
  const ctx = makeCtx(structuredClone(state));
  try {
    switch (action.kind) {
      case 'mulligan':
        submitMulligan(ctx, action);
        break;
      case 'play_card':
        playCard(ctx, action);
        break;
      case 'attack':
        attack(ctx, action);
        break;
      case 'hero_power':
        useHeroPower(ctx, action);
        break;
      case 'end_turn':
        endTurn(ctx);
        break;
    }
    if (ctx.state.phase === 'playing') resolveDeaths(ctx);
  } catch (e) {
    if (!(e instanceof GameOverSignal)) throw e;
  }
  if (invariantChecksEnabled()) assertInvariants(ctx.state);
  return { ok: true, state: ctx.state, events: ctx.events };
}
