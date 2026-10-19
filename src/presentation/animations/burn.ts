// 爆牌（m4-storyboard E04，1000ms）：牌从牌库飞到手牌区上方，放大 1.2 正对镜头（350ms 落），停 200ms 让玩家看清是哪张，
// 再从下往上烧掉（450ms 线），边缘橙色亮线，burn_ash 30 粒向上飘。声音：card.burn 在燃烧开始。
import { playSfx } from '../../audio';
import type { CardView } from '../../scene/cardView';
import { dispose } from '../../scene/dispose';
import { floatText } from '../fx/effects';
import { burnAway } from '../fx/flow';
import { above, burnSlot, deckSlot } from '../layout';
import type { AnimModule } from './types';
import { at, syncTo, tl, toSlot } from './util';

export const BURN = { show: 0.35, hold: 0.2, burn: 0.45 };

export const burn: AnimModule<'burn'> = (e, { scene, after }) => {
  const t = tl();
  const P = BURN;
  const p = scene.place(e.side);
  const target = burnSlot(p);
  const holder: { card: CardView | null } = { card: null };
  t.call(() => {
    const deck = deckSlot(p);
    const c = scene.makeCard(e.card.instanceId, e.card.cardId, { ...deck, pos: above(deck.pos, 0.6) });
    holder.card = c;
    toSlot(c, target, P.show, 'power2.out');
  });
  // 一行字在后台飘，不占这一步的时长
  t.call(() => void floatText(scene.layers.top, at(above(target.pos, 1.6)), '手牌已满', 0xff9a50, 34), undefined, P.show * 0.5);
  t.call(() => {
    const c = holder.card;
    if (!c) return;
    playSfx('card.burn', { pan: scene.panAt(c.position) });
    const pos = c.position;
    scene.particles.emit('burn_ash', { at: { x: pos.x, y: pos.y - 1.2, z: pos.z }, count: 30, dir: 'up' });
    burnAway(c, P.burn).call(() => dispose(c));
  }, undefined, P.show + P.hold);
  t.to({}, { duration: P.burn }, P.show + P.hold);
  t.add(syncTo(scene, after, 0.1));
  return { tl: t };
};
