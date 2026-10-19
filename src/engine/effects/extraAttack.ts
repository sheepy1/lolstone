import { findMinion, type Ctx } from '../context';
import type { EffectEnv } from './types';

// 再次攻击：本回合多一次攻击机会，不受风怒那样的次数上限限制。
// 只在拥有者自己的回合生效：对方回合里被攻击时反杀（易）照样触发 on_kill，但这个动作什么也不做。
// 没有单独的事件，前面的 trigger 事件就是它的表现。
export function extraAttack(ctx: Ctx, env: EffectEnv): void {
  if (env.selfId === null || ctx.state.current !== env.side) return;
  const loc = findMinion(ctx.state, env.selfId);
  if (!loc || loc.side !== env.side) return;
  loc.minion.extraAttacks += 1;
}
