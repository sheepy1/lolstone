// 抽牌（m4-storyboard E03，500ms）：牌库顶一张抬起 0.5 卡高（80ms 起），沿弧线飞到手牌末位（300ms 落），
// 我方的牌在飞行 40% 到 70% 之间绕长轴翻到正面，落位一个小回弹（120ms 弹）；其余手牌同时挪位（250ms 落）。
// 声音：card.draw 在翻面中点（对手抽牌在起飞时，不翻面）。
import { playSfx } from '../../audio';
import { flyFromDeck, FLOW } from '../fx/flow';
import { above, deckSlot } from '../layout';
import type { AnimModule } from './types';
import { tl } from './util';

export const draw: AnimModule<'draw'> = (e, { scene, after, viewer, step, index }) => {
  const t = tl();
  const mine = e.side === viewer;
  // 同一步里多张抽牌（同组）错开 120ms 起飞（E03 的"并行"）：按这一张在同一步同一方的抽牌里排第几算
  const nth = step && index !== undefined ? step.slice(0, index).filter((x) => x.kind === 'draw' && x.side === e.side).length : 0;
  const delay = nth * DRAW_STAGGER;
  t.call(() => {
    scene.spawnAtSlot = true;
    scene.sync(after, 0.25);
    scene.spawnAtSlot = false;
    const card = scene.handCards.get(e.card.instanceId);
    if (!card) return;
    const id = e.card.instanceId;
    scene.incomingHand.add(id);
    const from = above(deckSlot(scene.place(e.side)).pos, 0.3);
    const pan = scene.panAt(from);
    const fly = flyFromDeck(card, from, { flip: mine, onFlip: mine ? () => playSfx('card.draw', { pan }) : undefined });
    if (!mine) fly.call(() => playSfx('card.draw', { pan }), undefined, 0);
    fly.delay(delay);
    // 落位后并进扇形：飞行途中同一步的其他抽牌可能已经改了张数，槽位要按最新的张数重排
    fly.call(() => {
      scene.incomingHand.delete(id);
      scene.layoutHand(0.15);
    });
  });
  t.to({}, { duration: delay + FLOW.drawLift + FLOW.drawFly + FLOW.drawSettle });
  return { tl: t, tail: FLOW.drawSettle };
};

// 同组抽牌错开的间隔（m4-storyboard E03）
export const DRAW_STAGGER = 0.12;
