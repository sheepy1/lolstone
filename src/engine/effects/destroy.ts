import { findMinion, type Ctx } from '../context';
import type { TargetRef } from '../state';

// 消灭：标记待死，在随后的死亡结算中离场并发 death 事件。不是伤害，泰达米尔拦不住（spec 2.6）。
export function destroyTarget(ctx: Ctx, target: TargetRef): void {
  if (target.kind === 'hero') return;
  const loc = findMinion(ctx.state, target.instanceId);
  if (!loc) return;
  loc.minion.pendingDestroy = true;
}
