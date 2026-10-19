// 解冻（m4-storyboard E17 末尾，250ms）：ice_shatter 碎开，冰层 150ms 退去，徽章的淡蓝去掉。碎冰声在 t=0。
import { iceMelt } from '../fx/statusFx';
import { FREEZE, hold, sfxAt, targetX } from './combat';
import type { AnimModule } from './types';
import { tl } from './util';

export const unfreeze: AnimModule<'unfreeze'> = (e, { scene, after }) => {
  const F = FREEZE;
  const t = tl();
  const x = targetX(scene, e.target);
  t.call(() => {
    sfxAt('combat.unfreeze', x);
    const p = scene.pointOf(e.target);
    scene.particles.emit('ice_shatter', { at: { x: p.x, y: 0.35, z: p.z }, count: F.thawShatter });
    const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
    if (m) iceMelt(m, F.thaw);
  });
  t.call(() => void scene.sync(after, 0.1), undefined, F.thaw);
  hold(t, 0.25, 0);
  return { tl: t, order: x, stagger: F.stagger };
};
