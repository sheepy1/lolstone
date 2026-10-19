// 一方换牌完成：换掉的牌飞回牌库，新抽的牌从牌库飞到原来的位置。
import gsap from 'gsap';
import { playSfx } from '../../audio';
import { floatText } from '../fx/effects';
import type { AnimModule } from './types';
import { at, sideColor, syncTo, tl } from './util';
import { dispose } from '../../scene/dispose';

export const mulliganDone: AnimModule<'mulligan_done'> = (e, { scene, after, viewer }) => {
  const t = tl();
  const deck = scene.deckPoint(e.side);
  t.call(() => {
    for (const c of e.replaced) {
      const v = scene.takeHandCard(c.instanceId);
      if (!v) continue;
      gsap.to(v, { x: deck.x, y: deck.y, rotation: 0, alpha: 0.3, duration: 0.4, ease: 'power2.in', onComplete: () => dispose(v) });
      gsap.to(v.scale, { x: 0.6, y: 0.6, duration: 0.4 });
    }
    playSfx(e.replaced.length > 0 ? 'card.draw' : 'ui.click');
  });
  if (e.replaced.length > 0) t.to({}, { duration: 0.4 });
  const label = e.side === viewer ? (e.replaced.length > 0 ? `换了 ${e.replaced.length} 张` : '保留起手') : `对手换了 ${e.replaced.length} 张`;
  t.add(floatText(scene.layers.fx, at(e.side === viewer ? { x: 960, y: 300 } : { x: 960, y: 140 }), label, sideColor(e.side, viewer), 36), '<');
  t.add(syncTo(scene, after, 0.5));
  return { tl: t };
};
