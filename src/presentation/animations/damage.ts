// 受伤：目标泛红抖动，弹出伤害飘字，生命数字跳变；被圣盾挡下的部分弹白色飘字。
// 英雄受到 5 点及以上伤害时屏幕轻震。
import gsap from 'gsap';
import { playSfx } from '../../audio';
import { floatText } from '../fx/effects';
import type { AnimModule } from './types';
import { flash, pointOf, shake, tl } from './util';

export const damage: AnimModule<'damage'> = (e, { scene }) => {
  const t = tl();
  const body = scene.targetBody(e.target);
  const where = pointOf(scene, e.target);
  t.call(() => {
    playSfx(e.target.kind === 'hero' ? 'combat.hero_hit' : e.amount >= 5 ? 'combat.hit_heavy' : 'combat.hit_light');
    // 数字先跳到受伤后的值，血条跟着变
    if (e.target.kind === 'hero') scene.heroes[e.target.side].setHealth(e.healthAfter, scene.view.players[e.target.side].hero.maxHealth);
    else scene.minion(e.target.instanceId)?.showHealth(e.healthAfter);
  });
  if (body) {
    t.add(flash(body.flash, 0xff2020, 0.75, 0.35), 0);
    t.add(shake(body.body, e.amount >= 5 ? 12 : 7, 0.3), 0);
  }
  if (e.shieldAbsorbed > 0) t.add(floatText(scene.layers.fx, where, '格挡', 0xffffff, 40), 0);
  else t.add(floatText(scene.layers.fx, where, `-${e.amount}`, e.amount >= 5 ? 0xff7a20 : 0xff3030, 52), 0);
  if (e.lethalPrevented) t.add(floatText(scene.layers.fx, () => ({ x: where().x, y: where().y - 60 }), '免死', 0xffd070, 32), 0.2);
  if (e.target.kind === 'hero' && e.amount >= 5) {
    const root = scene.root;
    t.add(gsap.timeline().to(root, { x: 6, duration: 0.04 }).to(root, { x: -6, duration: 0.06 }).to(root, { x: 3, duration: 0.05 }).to(root, { x: 0, duration: 0.05 }), 0);
  }
  return { tl: t };
};
