// 从手牌打出一张牌（spec 5.6、m4-storyboard E06、E07、E09）：
// - 自己的随从牌：飞到落点上方、转平、略缩小，悬在那里，随后的 minion_summoned 把它砸成随从底座；
// - 自己的法术：沿弧线飞到中央放大展示，停一下，然后放大、提亮、缩没，接法术效果；
// - 对手的牌（E06，共 0.8 秒）：飞到中央放大，停 0.45 秒让玩家看清，再淡出。
import gsap from 'gsap';
import * as THREE from 'three';
import { playSfx } from '../../audio';
import type { CardView } from '../../scene/cardView';
import { fadeOutAndDispose } from '../../scene/dispose';
import { boardSlot, handSlot, showcaseSlot } from '../layout';
import { PLAY_MINION } from './minionSummoned';
import type { AnimModule } from './types';
import { syncTo, tl, toSlot } from './util';

const SPELL_HOLD = 0.35;
// 对手出牌按 E06（800ms）：飞入 250、停 450（让玩家看清，不能缩）、退场 100
const OPPONENT = { fly: 0.25, hold: 0.45, exit: 0.1 };

export const cardPlayed: AnimModule<'card_played'> = (e, { scene, before, after, viewer }) => {
  const t = tl();
  const mine = e.side === viewer;
  const p = scene.place(e.side);
  const show = showcaseSlot();
  const holder: { card: CardView | null } = { card: null };
  const minionOfMine = mine && e.cardType === 'minion' && e.position !== null;
  t.call(() => {
    playSfx('card.play');
    const count = before.players[e.side].hand.length;
    const c = scene.takeHandCard(e.card.instanceId) ?? scene.makeCard(e.card.instanceId, e.card.cardId, handSlot(p, e.handIndex, count));
    c.setCard(e.card.cardId);
    c.setHighlight(false);
    c.setDim(false);
    holder.card = c;
    gsap.killTweensOf([c.position, c.rotation, c.scale]);
    if (minionOfMine) {
      // 飞到落点上方，转平、略缩小，悬着等砸落
      const slot = boardSlot(p, e.position!, before.players[e.side].board.length + 1);
      toSlot(c, { pos: { ...slot.pos, y: PLAY_MINION.hover }, rot: { x: -Math.PI / 2, y: 0, z: 0 }, scale: 0.95 }, 0.12, 'power2.out');
      scene.pendingPlayCards.set(e.card.instanceId, c);
      return;
    }
    // 沿一条拱起的弧线飞到中央展示
    const from = c.position.clone();
    const to = new THREE.Vector3(show.pos.x, show.pos.y, show.pos.z);
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 1.2;
    const bez = new THREE.QuadraticBezierCurve3(from, mid, to);
    const r0 = c.rotation.clone();
    const s0 = c.scale.x;
    const st = { t: 0 };
    gsap.to(st, {
      t: 1,
      duration: mine ? 0.3 : OPPONENT.fly,
      ease: 'power2.out',
      onUpdate: () => {
        c.position.copy(bez.getPoint(st.t));
        c.rotation.set(r0.x + (show.rot.x - r0.x) * st.t, r0.y * (1 - st.t), r0.z * (1 - st.t));
        c.scale.setScalar(s0 + (show.scale - s0) * st.t);
      },
    });
  });
  t.add(syncTo(scene, after, minionOfMine ? 0.12 : mine ? 0.3 : OPPONENT.fly));
  if (minionOfMine) return { tl: t };
  t.to({}, { duration: mine ? SPELL_HOLD : OPPONENT.hold });
  // 退场：自己的法术放大、提亮再缩没（接效果）；对手的牌直接淡出
  t.call(() => {
    const c = holder.card;
    if (!c) return;
    if (mine) {
      c.flare();
      gsap.to(c.scale, { x: show.scale * 1.12, y: show.scale * 1.12, z: show.scale * 1.12, duration: 0.08, ease: 'power2.out', onComplete: () => fadeOutAndDispose(c, 0.14) });
    } else fadeOutAndDispose(c, OPPONENT.exit);
  });
  t.to({}, { duration: mine ? 0.2 : OPPONENT.exit });
  return { tl: t, tail: mine ? 0.2 : OPPONENT.exit };
};
