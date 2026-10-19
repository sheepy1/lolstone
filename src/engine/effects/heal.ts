import type { SourceRef } from '../events';
import { emit, findMinion, fxIdField, type Ctx } from '../context';
import type { Fx, TargetRef } from '../state';
import { updateEnrage } from './buff';

// 恢复生命，不超过上限（spec 2.6）。返回实际恢复量。
export function healCharacter(
  ctx: Ctx,
  group: number,
  source: SourceRef,
  target: TargetRef,
  amount: number,
  fx: Fx,
  fxId?: string,
): number {
  if (amount <= 0) return 0;
  if (target.kind === 'hero') {
    const hero = ctx.state.players[target.side].hero;
    const before = hero.health;
    hero.health = Math.min(hero.maxHealth, hero.health + amount);
    emit(ctx, group, {
      kind: 'heal',
      source,
      target,
      amount: hero.health - before,
      healthBefore: before,
      healthAfter: hero.health,
      fx,
      ...fxIdField(fxId),
    });
    return hero.health - before;
  }
  const loc = findMinion(ctx.state, target.instanceId);
  if (!loc) return 0;
  const m = loc.minion;
  const before = m.health;
  m.health = Math.min(m.maxHealth, m.health + amount);
  emit(ctx, group, {
    kind: 'heal',
    source,
    target,
    amount: m.health - before,
    healthBefore: before,
    healthAfter: m.health,
    fx,
    ...fxIdField(fxId),
  });
  updateEnrage(ctx, group, loc.side, m);
  return m.health - before;
}
