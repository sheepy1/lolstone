// 抽牌（m4-storyboard E03，500ms）：牌库顶一张抬起 0.5 卡高（80ms 起），沿弧线飞到手牌末位（300ms 落），
// 我方的牌在飞行 40% 到 70% 之间绕长轴翻到正面，落位一个小回弹（120ms 弹）；其余手牌同时挪位（250ms 落）。
// 声音：card.draw 在翻面中点（对手抽牌在起飞时，不翻面）。
import { playSfx } from '../../audio';
import { flyFromDeck, FLOW } from '../fx/flow';
import { above, deckSlot } from '../layout';
import type { AnimModule } from './types';
import { tl } from './util';

export const draw: AnimModule<'draw'> = (e, { scene, after, viewer }) => {
  const t = tl();
  const mine = e.side === viewer;
  t.call(() => {
    scene.spawnAtSlot = true;
    scene.sync(after, 0.25);
    scene.spawnAtSlot = false;
    const card = scene.handCards.get(e.card.instanceId);
    if (!card) return;
    const from = above(deckSlot(scene.place(e.side)).pos, 0.3);
    const pan = scene.panAt(from);
    if (!mine) playSfx('card.draw', { pan });
    flyFromDeck(card, from, { flip: mine, onFlip: mine ? () => playSfx('card.draw', { pan }) : undefined });
  });
  t.to({}, { duration: FLOW.drawLift + FLOW.drawFly + FLOW.drawSettle });
  return { tl: t };
};
