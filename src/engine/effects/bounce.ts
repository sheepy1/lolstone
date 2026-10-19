import { emit, findMinion, type Ctx } from '../context';
import type { SourceRef } from '../events';
import { MAX_HAND, type CardInstance, type Fx, type TargetRef } from '../state';

// 回手：随从移回拥有者手牌，变回一张卡面状态的牌（保留实例 id）。
// 手牌已满时直接销毁，不触发亡语（spec 2.9）。
export function bounceTarget(ctx: Ctx, group: number, source: SourceRef, target: TargetRef, fx: Fx): void {
  if (target.kind === 'hero') return;
  const loc = findMinion(ctx.state, target.instanceId);
  if (!loc) return;
  const p = ctx.state.players[loc.side];
  const m = loc.minion;
  p.board = p.board.filter((x) => x !== m);
  const ref: TargetRef = { side: loc.side, kind: 'minion', instanceId: m.instanceId };
  if (p.hand.length >= MAX_HAND) {
    emit(ctx, group, {
      kind: 'bounce',
      source,
      target: ref,
      cardId: m.cardId,
      position: loc.index,
      handIndex: null,
      destroyed: true,
      card: null,
      fx,
    });
    return;
  }
  const card: CardInstance = { instanceId: m.instanceId, cardId: m.cardId };
  p.hand = [...p.hand, card];
  emit(ctx, group, {
    kind: 'bounce',
    source,
    target: ref,
    cardId: m.cardId,
    position: loc.index,
    handIndex: p.hand.length - 1,
    destroyed: false,
    card,
    fx,
  });
}
