// 一方换牌完成（m4-first-minutes 第 4 步）：换掉的牌飞回牌库（400ms 起），新抽的牌从牌库逐张飞到原来的位置，
// 飞行中翻到正面（同 E03 的飞行，错开 120ms）。对手的牌背面朝上，不翻。
// 声音：确认按钮的声音在界面层；换牌飞回用 card.draw 一声，每张新牌翻面时 card.draw。一张都没换时只出一行字。
import gsap from 'gsap';
import { playSfx } from '../../audio';
import { dispose } from '../../scene/dispose';
import { floatText } from '../fx/effects';
import { flyFromDeck } from '../fx/flow';
import { above, deckSlot } from '../layout';
import type { AnimModule } from './types';
import { at, sideColor, tl } from './util';

export const MULLIGAN = {
  back: 0.4, // 换掉的牌飞回牌库
  gap: 0.12, // 新牌逐张错开
};

export const mulliganDone: AnimModule<'mulligan_done'> = (e, { scene, after, viewer }) => {
  const t = tl();
  const mine = e.side === viewer;
  const deck = scene.deckPoint(e.side);
  t.call(() => {
    for (const c of e.replaced) {
      const v = scene.takeHandCard(c.instanceId);
      if (!v) continue;
      gsap.to(v.position, { ...deck, duration: MULLIGAN.back, ease: 'power3.in', onComplete: () => dispose(v) });
      gsap.to(v.rotation, { x: -Math.PI / 2, y: Math.PI, z: 0, duration: MULLIGAN.back });
      gsap.to(v.scale, { x: 0.75, y: 0.75, z: 0.75, duration: MULLIGAN.back });
    }
    if (e.replaced.length > 0) playSfx('card.draw', { pan: scene.panAt(deck) });
  });
  const label = mine ? (e.replaced.length > 0 ? `换了 ${e.replaced.length} 张` : '保留起手') : `对手换了 ${e.replaced.length} 张`;
  // 一行字在后台飘，不占这一步的时长
  t.call(() => void floatText(scene.layers.top, at(mine ? { x: 0, y: 4.5, z: 1.5 } : { x: 0, y: 1, z: -6 }), label, sideColor(e.side, viewer), 36));
  if (e.replaced.length === 0) {
    t.call(() => scene.sync(after, 0.3));
    t.to({}, { duration: 0.3 });
    return { tl: t, tail: 0.3 };
  }
  // 新牌：sync 放到位置上，再从牌库飞过去
  t.call(
    () => {
      scene.spawnAtSlot = true;
      scene.sync(after, 0.3);
      scene.spawnAtSlot = false;
      const from = above(deckSlot(scene.place(e.side)).pos, 0.3);
      e.drawn.forEach((c, i) => {
        const card = scene.handCards.get(c.instanceId);
        if (!card) return;
        flyFromDeck(card, from, { flip: mine, onFlip: mine ? () => playSfx('card.draw', { pan: scene.panAt(card.position) }) : undefined }).delay(i * MULLIGAN.gap);
      });
    },
    undefined,
    MULLIGAN.back,
  );
  t.to({}, { duration: e.drawn.length * MULLIGAN.gap + 0.5 });
  return { tl: t, tail: 0.3 };
};
