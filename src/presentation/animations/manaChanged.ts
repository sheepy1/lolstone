// 法力变化：法力条闪一下，逐格亮或暗。
import { playSfx } from '../../audio';
import type { AnimModule } from './types';
import { flash, syncTo, tl } from './util';

export const manaChanged: AnimModule<'mana_changed'> = (e, { scene, after }) => {
  const t = tl();
  t.call(() => playSfx('flow.mana'));
  const gained = e.after.current > e.before.current || e.after.max > e.before.max;
  t.add(flash(scene.mana[e.side].flash, gained ? 0x60b0ff : 0x203050, 0.5, 0.25), 0);
  t.add(syncTo(scene, after, 0.2), 0);
  return { tl: t };
};
