// 回手：随从缩小飞回手牌（手牌满被销毁时原地消散）。
import { playSfx } from '../../audio';
import { burst, floatText } from '../fx/effects';
import type { AnimModule } from './types';
import { pointOf, syncTo, tl } from './util';

export const bounce: AnimModule<'bounce'> = (e, { scene, after }) => {
  const t = tl();
  const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
  const where = pointOf(scene, e.target);
  t.call(() => playSfx('card.bounce'));
  if (m) {
    if (e.destroyed) {
      t.to(m.body.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.35 }, 0);
      t.add(burst(scene.layers.fx, where, 0xb0b0ff, 16, 0.4), 0);
      t.add(floatText(scene.layers.top, where, '手牌已满', 0xff9a50, 30), 0);
    } else {
      // 先抬高再往手牌方向飘，路线高过我方枢纽，不被挡住
      const toZ = scene.place(e.target.side) === 'near' ? 7.3 : -7.7;
      t.to(m.body.position, { y: 2.8, z: (toZ - m.position.z) * 0.45, duration: 0.35, ease: 'power2.out' }, 0);
      t.to(m.body.scale, { x: 0.55, y: 0.55, z: 0.55, duration: 0.35 }, 0);
    }
  }
  if (e.card && !e.destroyed) {
    const card = e.card;
    t.call(() => scene.handSpawn.set(card.instanceId, { ...where(), y: 2.8 }), undefined, 0.3);
  }
  t.add(syncTo(scene, after, 0.35), 0.3);
  return { tl: t };
};
