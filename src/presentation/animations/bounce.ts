// 回手（m4-storyboard E21，500ms，轻偏中）：
// 收缩 150ms（起）：底座缩小，一张卡从中升起 → 飞回 300ms（落）：弧线飞回手牌，手牌重排 → 落位 50ms（弹）。
// 手牌满被销毁：卡飞到手牌区上方后走 E04 的燃烧段（从下往上烧掉，burn_ash 向上飘）。场上的空位按 E14 的合拢收起。
// 声音：card.bounce（magic 回手声）在 t=0，落位时 ui.drop。
import { playSfx } from '../../audio';
import { HIDDEN_CARD_ID } from '../../engine';
import { dispose } from '../../scene/dispose';
import { burnAway, flyFromDeck } from '../fx/flow';
import { floatText } from '../fx/effects';
import { above, burnSlot } from '../layout';
import { BURN } from './burn';
import type { AnimModule } from './types';
import { at, pointOf, tl, toSlot } from './util';

export const BOUNCE = { shrink: 0.15, fly: 0.3, settle: 0.05 };

export const bounce: AnimModule<'bounce'> = (e, { scene, after }) => {
  const t = tl();
  const P = BOUNCE;
  const where = pointOf(scene, e.target);
  const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
  // 起点：底座顶面上方
  const start = () => ({ ...where(), y: 0.6 });
  t.call(() => playSfx('card.bounce', { pan: scene.panAt(where()) }));
  // 收缩（起）：底座缩小
  if (m) t.to(m.body.scale, { x: 0.3, y: 0.3, z: 0.3, duration: P.shrink, ease: 'power3.in' }, 0);

  if (e.destroyed || !e.card) {
    // 手牌满：卡升到手牌区上方，然后烧掉（E04 的燃烧段）
    const holder: { card: ReturnType<typeof scene.makeCard> | null } = { card: null };
    const cardId = e.cardId;
    t.call(
      () => {
        const p = start();
        const c = scene.makeCard(-2000 - e.position, scene.place(e.target.side) === 'near' ? cardId : HIDDEN_CARD_ID, {
          pos: p,
          rot: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: 0.6,
        });
        holder.card = c;
        toSlot(c, burnSlot(scene.place(e.target.side)), P.fly, 'power2.out');
        scene.sync(after, 0.25); // 场上空位合拢
        void floatText(scene.layers.top, at(above(burnSlot(scene.place(e.target.side)).pos, 1.6)), '手牌已满', 0xff9a50, 34);
      },
      undefined,
      P.shrink,
    );
    t.call(
      () => {
        const c = holder.card;
        if (!c) return;
        playSfx('card.burn', { pan: scene.panAt(c.position) });
        scene.particles.emit('burn_ash', { at: { x: c.position.x, y: c.position.y - 1.2, z: c.position.z }, count: 30, dir: 'up' });
        burnAway(c, BURN.burn).call(() => dispose(c));
      },
      undefined,
      P.shrink + P.fly + BURN.hold,
    );
    t.to({}, { duration: BURN.burn }, P.shrink + P.fly + BURN.hold);
    return { tl: t, tail: BURN.burn * 0.5 };
  }

  // 回到手牌：sync 把那张牌放到手牌里的位置（底座同时消失、空位合拢），再从底座上方沿弧线飞过去
  const id = e.card.instanceId;
  t.call(
    () => {
      scene.spawnAtSlot = true;
      scene.sync(after, 0.25);
      scene.spawnAtSlot = false;
      const card = scene.handCards.get(id);
      if (!card) return;
      scene.incomingHand.add(id);
      const fly = flyFromDeck(card, start(), { flip: false, lift: 0.5 });
      fly.call(() => {
        scene.incomingHand.delete(id);
        scene.layoutHand(0.15);
        playSfx('ui.drop', { pan: scene.panAt(card.position) });
      });
    },
    undefined,
    P.shrink * 0.6,
  );
  t.to({}, { duration: P.fly + P.settle + 0.15 }, P.shrink * 0.6);
  return { tl: t, tail: P.settle + 0.1 };
};
