// 胜负：输的一方水晶枢纽震动、晶体闪亮后碎裂，"胜利"或"失败"落下。结算面板由界面层在动画播完后升起。
import { other } from '../../engine';
import { playSfx } from '../../audio';
import { banner, burst } from '../fx/effects';
import { bannerSlot } from '../layout';
import type { AnimModule } from './types';
import { pointOf, shake, tl } from './util';

export const gameOver: AnimModule<'game_over'> = (e, { scene, viewer }) => {
  const t = tl();
  const won = e.winner === viewer;
  const text = e.winner === 'draw' ? '平局' : won ? '胜利' : '失败';
  t.call(() => playSfx(e.winner === 'draw' ? 'flow.defeat' : won ? 'flow.victory' : 'flow.defeat'));
  const losers = e.winner === 'draw' ? [0, 1] : [other(e.winner)];
  for (const side of losers as (0 | 1)[]) {
    const hero = scene.heroes[side];
    t.add(shake(hero.body, 0.16, 0.6), 0);
    t.add(hero.shatter(), 0.5);
    t.add(burst(scene.layers.fx, () => ({ ...pointOf(scene, { side, kind: 'hero' })(), y: 1.6 }), 0xffd0a0, 80, 0.9), 0.8);
  }
  t.add(scene.shake(0.15), 0.8);
  t.add(banner(scene.layers.top, bannerSlot(), text, won ? 0xffd040 : 0xd0d0d0, 1.4, 120), 0.9);
  return { tl: t };
};
