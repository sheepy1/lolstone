// 爆牌：牌从牌库飞到手牌上方展示，烧成灰飘散。
import { playSfx } from '../../audio';
import type { CardView } from '../../scene/cardView';
import { fadeOutAndDispose } from '../../scene/dispose';
import { burst, floatText } from '../fx/effects';
import { above, burnSlot, deckSlot } from '../layout';
import type { AnimModule } from './types';
import { at, syncTo, tl, toSlot } from './util';

export const burn: AnimModule<'burn'> = (e, { scene, after }) => {
  const t = tl();
  const p = scene.place(e.side);
  const target = burnSlot(p);
  const holder: { card: CardView | null } = { card: null };
  t.call(() => {
    const deck = deckSlot(p);
    const c = scene.makeCard(e.card.instanceId, e.card.cardId, { ...deck, pos: above(deck.pos, 0.6) });
    holder.card = c;
    toSlot(c, target, 0.35);
  });
  t.to({}, { duration: 0.6 });
  t.call(() => {
    playSfx('card.burn');
    const c = holder.card;
    if (!c) return;
    c.setBurning();
    fadeOutAndDispose(c, 0.35);
  });
  t.add(burst(scene.layers.fx, at(target.pos), 0xff7030, 30, 0.5), '<');
  t.add(floatText(scene.layers.top, at(above(target.pos, 0.6)), '手牌已满', 0xff9a50, 34), '<');
  t.add(syncTo(scene, after, 0.1));
  return { tl: t };
};
