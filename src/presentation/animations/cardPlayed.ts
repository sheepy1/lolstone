// 从手牌打出一张牌：对手的牌放大停在中央 0.8 秒让玩家看清；自己的法术在中央短暂展示；
// 自己的随从牌直接缩向落点（随后的 minion_summoned 让它变成头像）。
import gsap from 'gsap';
import { playSfx } from '../../audio';
import { boardSlot, handSlot, showcaseSlot } from '../layout';
import type { AnimModule } from './types';
import { syncTo, tl } from './util';
import { fadeOutAndDispose } from '../../scene/dispose';

export const cardPlayed: AnimModule<'card_played'> = (e, { scene, before, after, viewer }) => {
  const t = tl();
  const mine = e.side === viewer;
  const p = scene.place(e.side);
  const show = showcaseSlot();
  const holder: { card: ReturnType<typeof scene.makeCard> | null } = { card: null };
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
      gsap.to(c, { x: slot.x, y: slot.y, rotation: 0, alpha: 0, duration: 0.3, ease: 'power2.in' });
      gsap.to(c.scale, { x: 0.5, y: 0.5, duration: 0.3 });
    } else {
      gsap.to(c, { x: show.x, y: show.y, rotation: 0, duration: 0.3, ease: 'power2.out' });
      gsap.to(c.scale, { x: show.scale, y: show.scale, duration: 0.3, ease: 'back.out(1.6)' });
    }
  });
  t.add(syncTo(scene, after, 0.3));
  // 对手的牌停 0.8 秒；自己的法术停短一点
  if (!mine) t.to({}, { duration: 0.8 });
  else if (e.cardType === 'spell') t.to({}, { duration: 0.25 });
  t.call(() => {
    const c = holder.card;
    if (!c) return;
    fadeOutAndDispose(c);
  });
  t.to({}, { duration: 0.15 });
  return { tl: t };
};
