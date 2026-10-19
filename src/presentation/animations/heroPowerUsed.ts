// 英雄技能：技能物件按下回弹发光，有目标时效果飞向目标；之后顶面盖灰。
import gsap from 'gsap';
import { playSfx } from '../../audio';
import { REGION_COLORS } from '../../scene/theme';
import { projectile, ring } from '../fx/effects';
import type { AnimModule } from './types';
import { at, pointOf, syncTo, tl } from './util';

export const heroPowerUsed: AnimModule<'hero_power_used'> = (e, { scene, after }) => {
  const t = tl();
  const cls = after.players[e.side].heroClass;
  const color = REGION_COLORS[cls].accent;
  const from = scene.heroPowerPoint(e.side);
  const icon = scene.heroPowers[e.side].body;
  t.call(() => playSfx(`hero_power.${cls}`));
  t.to(icon.position, { y: -0.12, duration: 0.08 });
  t.to(icon.position, { y: 0.25, duration: 0.12, ease: 'back.out(3)' });
  t.add(ring(scene.layers.fx, at(from), color, 80, 0.35), '<');
  t.to(icon.position, { y: 0, duration: 0.15 });
  if (e.target) t.add(projectile(scene.layers.fx, at(from), pointOf(scene, e.target), color, 0.3), 0.15);
  t.add(syncTo(scene, after, 0.1));
  t.call(() => gsap.set(icon.position, { y: 0 }));
  return { tl: t };
};
