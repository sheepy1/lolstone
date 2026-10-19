// 从手牌打出一张牌（spec 5.6、m4-storyboard E06、E07、E09）：
// - 自己的随从牌：飞到落点上方、转平、略缩小，悬在那里，随后的 minion_summoned 把它砸成随从底座；
// - 自己的法术（E09，展示缩到 300ms）：沿弧线飞到中央放大，停 150ms，停的时候卡面按 fx 色发光；
// - 对手的牌（E06，共 0.8 秒）：飞到中央放大，飞行的前 40% 翻面，停 0.45 秒让玩家看清；法术的卡面按 fx 色发光；
// - 法术停完把牌交给 spell_cast（fx/spellFx.ts 的 holdForCast），由它溶解成光（E06 的退场、E09 的溶解）接效果；
//   对手的随从牌停完淡出（退场 100ms），接 minion_summoned。
import gsap from 'gsap';
import * as THREE from 'three';
import { playSfx } from '../../audio';
import type { CardView } from '../../scene/cardView';
import { fadeOutAndDispose } from '../../scene/dispose';
import { boardSlot, handSlot, showcaseSlot } from '../layout';
import { glowCard, holdForCast } from '../fx/spellFx';
import { planSpell, SPELL } from '../fx/spellPlan';
import { PLAY_MINION } from './minionSummoned';
import type { AnimModule } from './types';
import { syncTo, tl, toSlot } from './util';

// 对手出牌按 E06（800ms）：飞入 250、停 450（让玩家看清，不能缩）、退场 100。法术的退场是 spell_cast 的溶解
const OPPONENT = { fly: SPELL.theirs.fly, hold: SPELL.theirs.hold, exit: 0.1 };

export const cardPlayed: AnimModule<'card_played'> = (e, { scene, before, after, viewer }) => {
  const t = tl();
  const mine = e.side === viewer;
  const p = scene.place(e.side);
  const show = showcaseSlot();
  const holder: { card: CardView | null } = { card: null };
  const minionOfMine = mine && e.cardType === 'minion' && e.position !== null;
  const spell = e.cardType === 'spell';
  const fx = spell ? planSpell(e.card.cardId, e.side, e.target, before).fx : null;
  const fly = mine ? SPELL.mine.fly : OPPONENT.fly;
  t.call(() => {
    playSfx('card.play');
    const count = before.players[e.side].hand.length;
    const c = scene.takeHandCard(e.card.instanceId) ?? scene.makeCard(e.card.instanceId, e.card.cardId, handSlot(p, e.handIndex, count));
    c.setCard(e.card.cardId);
    c.setHighlight(false);
    c.setDim(false);
    holder.card = c;
    gsap.killTweensOf([c.position, c.rotation, c.scale]);
    // 对手思考时抬起的就是这张（E27 的衔接）：从抬起的状态直接飞出，抬起的偏移在飞行中收回
    gsap.killTweensOf([c.body.position, c.body.rotation]);
    gsap.to(c.body.position, { x: 0, y: 0, z: 0, duration: fly, ease: 'power2.out' });
    gsap.to(c.body.rotation, { x: 0, y: 0, z: 0, duration: fly, ease: 'power2.out' });
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
    // 对手的牌在飞行的前 40% 翻过来（E06），自己的牌本来就是正面，转正跟着整段飞行
    const flip = mine ? 1 : SPELL.theirs.flip;
    gsap.to(st, {
      t: 1,
      duration: fly,
      ease: 'power2.out',
      onUpdate: () => {
        const r = Math.min(1, st.t / flip);
        c.position.copy(bez.getPoint(st.t));
        c.rotation.set(r0.x + (show.rot.x - r0.x) * r, r0.y * (1 - r), r0.z * (1 - r));
        c.scale.setScalar(s0 + (show.scale - s0) * st.t);
      },
    });
    if (fx) glowCard(c, fx, fly);
  });
  t.add(syncTo(scene, after, minionOfMine ? 0.12 : fly));
  if (minionOfMine) return { tl: t };
  t.to({}, { duration: mine ? SPELL.mine.hold : OPPONENT.hold });
  if (fx) {
    // 停完交给 spell_cast 溶解。这一步不报 tail：溶解要等展示停够了才开始
    t.call(() => {
      if (holder.card) holdForCast(scene, e.card.instanceId, holder.card, fx);
    });
    return { tl: t };
  }
  // 对手的随从牌：淡出，接 minion_summoned
  t.call(() => {
    if (holder.card) fadeOutAndDispose(holder.card, OPPONENT.exit);
  });
  t.to({}, { duration: OPPONENT.exit });
  return { tl: t, tail: OPPONENT.exit };
};
