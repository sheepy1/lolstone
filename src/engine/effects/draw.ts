import { emit, heroRef, type Ctx } from '../context';
import { MAX_HAND, type Side } from '../state';
import { dealDamage } from './damage';

// 抽一张牌（spec 2.9）：牌库空则疲劳，手牌满则爆牌。
export function drawCard(ctx: Ctx, group: number, side: Side): void {
  const p = ctx.state.players[side];
  const card = p.deck[0];
  if (!card) {
    p.fatigue += 1;
    emit(ctx, group, { kind: 'fatigue', side, amount: p.fatigue });
    dealDamage(ctx, group, { kind: 'fatigue', side }, null, heroRef(side), p.fatigue, 'shadow');
    return;
  }
  p.deck = p.deck.slice(1);
  if (p.hand.length >= MAX_HAND) {
    emit(ctx, group, { kind: 'burn', side, card });
    return;
  }
  p.hand = [...p.hand, card];
  emit(ctx, group, { kind: 'draw', side, card, handIndex: p.hand.length - 1 });
}
