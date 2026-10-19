// 法术生效：有目标时一道按 fx 着色的飞弹从中央飞向目标、命中处闪光；无目标时中央扩散一圈。
import { playSfx } from '../../audio';
import { getCard } from '../../engine';
import { FX_COLORS } from '../../scene/theme';
import { projectile, ring } from '../fx/effects';
import { showcaseSlot } from '../layout';
import type { AnimModule } from './types';
import { at, pointOf, tl } from './util';

export const spellCast: AnimModule<'spell_cast'> = (e, { scene }) => {
  const t = tl();
  const fx = firstFx(e.card.cardId);
  const color = FX_COLORS[fx];
  const show = showcaseSlot();
  t.call(() => playSfx(`spell.${fx}`));
  if (e.target) {
    t.add(projectile(scene.layers.fx, at(show.pos), pointOf(scene, e.target), color, 0.3));
    t.add(ring(scene.layers.fx, pointOf(scene, e.target), color, 70, 0.25));
  } else {
    t.add(ring(scene.layers.fx, at(show.pos), color, 260, 0.5));
  }
  return { tl: t };
};

function firstFx(cardId: string) {
  for (const eff of getCard(cardId).effects ?? []) {
    if (eff.trigger === 'static') continue;
    for (const a of eff.actions) if ('fx' in a) return a.fx;
  }
  return 'holy' as const;
}
