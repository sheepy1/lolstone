// 疲劳：疲劳标记从牌库飞到中央展示，然后飞向英雄（伤害本身是随后的 damage 事件）。
import { playSfx } from '../../audio';
import { floatText, projectile } from '../fx/effects';
import type { AnimModule } from './types';
import { at, pointOf, syncTo, tl } from './util';

export const fatigue: AnimModule<'fatigue'> = (e, { scene, after }) => {
  const t = tl();
  const deck = scene.deckPoint(e.side);
  t.call(() => playSfx('flow.fatigue'));
  t.add(floatText(scene.layers.top, at({ x: 960, y: 540 }), `疲劳 ${e.amount}`, 0xb080ff, 72));
  t.add(projectile(scene.layers.fx, at(deck), pointOf(scene, { side: e.side, kind: 'hero' }), 0x9050ff, 0.4), 0.2);
  t.add(syncTo(scene, after, 0.1));
  return { tl: t };
};
