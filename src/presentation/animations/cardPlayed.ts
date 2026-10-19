// 从手牌打出一张牌：对手的牌放大停在中央 0.8 秒让玩家看清；自己的法术在中央短暂展示；
// 自己的随从牌直接缩向落点（随后的 minion_summoned 让它变成底座）。
import { playSfx } from '../../audio';
import type { CardView } from '../../scene/cardView';
import { fadeOutAndDispose } from '../../scene/dispose';
import { boardSlot, handSlot, showcaseSlot } from '../layout';
import type { AnimModule } from './types';
import { syncTo, tl, toSlot } from './util';

export const cardPlayed: AnimModule<'card_played'> = (e, { scene, before, after, viewer }) => {
  const t = tl();
  const mine = e.side === viewer;
  const p = scene.place(e.side);
  const holder: { card: CardView | null } = { card: null };
  t.call(() => {
    playSfx('card.play');
    const count = before.players[e.side].hand.length;
    const c = scene.takeHandCard(e.card.instanceId) ?? scene.makeCard(e.card.instanceId, e.card.cardId, handSlot(p, e.handIndex, count));
    c.setCard(e.card.cardId);
    c.setHighlight(false);
    c.setDim(false);
    holder.card = c;
    if (mine && e.cardType === 'minion' && e.position !== null) {
      const slot = boardSlot(p, e.position, before.players[e.side].board.length + 1);
      toSlot(c, { pos: { ...slot.pos, y: 0.4 }, rot: { x: -Math.PI / 2, y: 0, z: 0 }, scale: 0.5 }, 0.3, 'power2.in');
    } else {
      toSlot(c, showcaseSlot(), 0.3, 'back.out(1.4)');
    }
  });
  t.add(syncTo(scene, after, 0.3));
  // 对手的牌停 0.8 秒；自己的法术停短一点
  if (!mine) t.to({}, { duration: 0.8 });
  else if (e.cardType === 'spell') t.to({}, { duration: 0.25 });
  t.call(() => {
    if (holder.card) fadeOutAndDispose(holder.card);
  });
  t.to({}, { duration: 0.15 });
  return { tl: t };
};
