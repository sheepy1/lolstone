import { emit, findMinion, fxIdField, minionRef, type Ctx } from '../context';
import { createMinion } from '../minion';
import { MAX_BOARD, type Fx } from '../state';
import type { EffectEnv } from './types';

// 召唤衍生物到效果拥有者一方（spec 2.12）。场上满 7 个时剩下的不召唤，没有补偿（spec 2.9）。
export function summonTokens(ctx: Ctx, group: number, env: EffectEnv, token: string, count: number, fx: Fx, fxId?: string): void {
  const p = ctx.state.players[env.side];
  for (let i = 0; i < count; i++) {
    if (p.board.length >= MAX_BOARD) return;
    const index = nextSummonIndex(ctx, env);
    const m = createMinion(ctx, token);
    p.board = [...p.board.slice(0, index), m, ...p.board.slice(index)];
    // 多个时依次向右：下一个放在刚召唤的这个右边
    env.summon = { mode: 'at', index: index + 1 };
    emit(ctx, group, {
      kind: 'minion_summoned',
      side: env.side,
      target: minionRef(env.side, m),
      cardId: m.cardId,
      position: index,
      via: env.summonVia,
      attack: m.attack,
      health: m.health,
      source: env.source,
      fx,
      ...fxIdField(fxId),
    });
  }
}

function nextSummonIndex(ctx: Ctx, env: EffectEnv): number {
  const board = ctx.state.players[env.side].board;
  switch (env.summon.mode) {
    case 'at':
      return Math.min(env.summon.index, board.length);
    case 'right_of_self': {
      const loc = env.selfId === null ? null : findMinion(ctx.state, env.selfId);
      return loc && loc.side === env.side ? loc.index + 1 : board.length;
    }
    case 'rightmost':
      return board.length;
  }
}
