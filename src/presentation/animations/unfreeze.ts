// 解冻（m4-storyboard E17 末尾；按用户 2026-10-20 的反馈重做，650ms）：
// 0ms：冰壳上的裂纹亮起来（150ms），底座轻抖；
// 150ms：碎冰声，冰棱向外飞散、落到台面上缩小消融，头像上的冰面按晶格一块块碎掉，ice_shatter 碎冰，冷雾和雪点淡出（500ms）；
//   徽章上的霜同时去掉（显示局面在这一刻同步成解冻，冰壳等碎完再藏）。
import { FREEZE, hold, jitter, sfxAt, targetX, UNIT } from './combat';
import type { AnimModule } from './types';
import { tl } from './util';

export const unfreeze: AnimModule<'unfreeze'> = (e, { scene, after }) => {
  const F = FREEZE;
  const t = tl();
  const x = targetX(scene, e.target);
  const m = () => (e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined);
  t.call(() => {
    const v = m();
    if (!v) return;
    v.ice.crack(F.crack);
    jitter(v.body, F.shakeAmp * UNIT.base * 0.6, 3, F.crack);
  });
  t.call(
    () => {
      sfxAt('combat.unfreeze', x);
      const p = scene.pointOf(e.target);
      scene.particles.emit('ice_shatter', { at: { x: p.x, y: 0.35, z: p.z }, count: F.thawShatter });
      const v = m();
      v?.ice.shatter(F.shatter);
      scene.sync(after, 0.1);
    },
    undefined,
    F.crack,
  );
  hold(t, F.thawTotal, 0);
  // 收尾：冰片飞散、落地消融这一段（分镜 1.7 的组间重叠）
  return { tl: t, order: x, stagger: F.stagger, tail: F.thawTotal - F.crack };
};
