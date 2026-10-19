// 爆牌：牌从牌库飞到手牌上方展示，烧成灰飘散。
import gsap from 'gsap';
import { playSfx } from '../../audio';
import { burst, floatText } from '../fx/effects';
import { burnSlot, deckSlot } from '../layout';
import type { AnimModule } from './types';
import { at, syncTo, tl } from './util';
import { fadeOutAndDispose } from '../../scene/dispose';

export const burn: AnimModule<'burn'> = (e, { scene, after }) => {
  const t = tl();
  const p = scene.place(e.side);
  const target = burnSlot(p);
  const holder: { card: ReturnType<typeof scene.makeCard> | null } = { card: null };
  t.call(() => {
    const c = scene.makeCard(e.card.instanceId, e.card.cardId, deckSlot(p));
    holder.card = c;
    gsap.to(c, { x: target.x, y: target.y, duration: 0.35, ease: 'power2.out' });
    gsap.to(c.scale, { x: target.scale, y: target.scale, duration: 0.35 });
  });
  t.to({}, { duration: 0.6 });
  t.call(() => {
    playSfx('card.burn');
    const c = holder.card;
    if (!c) return;
    c.tint = 0xff7030;
    fadeOutAndDispose(c, 0.35);
  });
  t.add(burst(scene.layers.fx, at(target), 0x5a4030, 26, 0.5), '<');
  t.add(floatText(scene.layers.fx, at({ x: target.x, y: target.y - 140 }), '手牌已满', 0xff9a50, 34), '<');
  t.add(syncTo(scene, after, 0.1));
  return { tl: t };
};
