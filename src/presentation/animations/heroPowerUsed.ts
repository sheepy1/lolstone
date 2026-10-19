// 英雄技能：图标按下发光，有目标时效果飞向目标；之后图标盖上冷却遮罩。
import gsap from 'gsap';
import { playSfx } from '../../audio';
import { projectile, ring } from '../fx/effects';
import { REGION_COLORS } from '../../scene/theme';
import type { AnimModule } from './types';
import { at, pointOf, syncTo, tl } from './util';

export const heroPowerUsed: AnimModule<'hero_power_used'> = (e, { scene, after }) => {
  const t = tl();
  const cls = after.players[e.side].heroClass;
  const color = REGION_COLORS[cls].accent;
  const from = scene.heroPowerPoint(e.side);
  const icon = scene.heroPowers[e.side].body;
  t.call(() => playSfx(`hero_power.${cls}`));
  t.to(icon.scale, { x: 0.85, y: 0.85, duration: 0.08 });
  t.to(icon.scale, { x: 1.15, y: 1.15, duration: 0.12, ease: 'back.out(3)' });
  t.add(ring(scene.layers.fx, at(from), color, 80, 0.35), '<');
  t.to(icon.scale, { x: 1, y: 1, duration: 0.15 });
  if (e.target) t.add(projectile(scene.layers.fx, at(from), pointOf(scene, e.target), color, 0.3), 0.15);
  t.add(syncTo(scene, after, 0.1));
  // 防止 scale 动画被打断时留在放大状态
  t.call(() => gsap.set(icon.scale, { x: 1, y: 1 }));
  return { tl: t };
};
