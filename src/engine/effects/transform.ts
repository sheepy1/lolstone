import { emit, findMinion, fxIdField, minionRef, type Ctx } from '../context';
import type { SourceRef } from '../events';
import { createMinion } from '../minion';
import type { Fx, TargetRef } from '../state';

// 变形（spec 2.13）：原位置换成一个全新的随从（新实例 id、新入场顺序、本回合入场），
// 不算死亡，不触发原随从的亡语。
export function transformTarget(
  ctx: Ctx,
  group: number,
  source: SourceRef,
  target: TargetRef,
  into: string,
  fx: Fx,
  fxId?: string,
): void {
  if (target.kind === 'hero') return;
  const loc = findMinion(ctx.state, target.instanceId);
  if (!loc) return;
  const p = ctx.state.players[loc.side];
  const old = loc.minion;
  const m = createMinion(ctx, into);
  p.board = p.board.map((x) => (x === old ? m : x));
  ctx.kills = ctx.kills.filter((k) => k.victim !== old.instanceId);
  emit(ctx, group, {
    kind: 'transform',
    source,
    target,
    cardId: old.cardId,
    into,
    newTarget: minionRef(loc.side, m),
    position: loc.index,
    attack: m.attack,
    health: m.health,
    fx,
    ...fxIdField(fxId),
  });
}
