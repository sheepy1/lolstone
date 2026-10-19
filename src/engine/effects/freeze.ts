import { emit, findMinion, fxIdField, type Ctx } from '../context';
import type { SourceRef } from '../events';
import type { Fx, TargetRef } from '../state';

// 冻结（spec 2.7）：记下冻结发生的回合。英雄不能被冻结，冻结英雄直接忽略、不发事件。
export function freezeTarget(ctx: Ctx, group: number, source: SourceRef, target: TargetRef, fx: Fx, fxId?: string): void {
  if (target.kind === 'hero') return;
  const loc = findMinion(ctx.state, target.instanceId);
  if (!loc) return;
  loc.minion.frozenAt = ctx.state.turn;
  emit(ctx, group, { kind: 'freeze', source, target, frozenAt: ctx.state.turn, fx, ...fxIdField(fxId) });
}
