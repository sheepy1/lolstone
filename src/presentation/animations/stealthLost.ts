// 失去潜行（m4-storyboard E19 解除，攻击之后）：烟散开（stealth_smoke 6），透明度 150ms 回到 1，烟幕淡出，
// 底座上沿的潜行图标缩小淡出（300ms）。烟雾声在 t=0。
import { keywordStamp, stealthFadeOut } from '../fx/statusFx';
import { hold, sfxAt, STEALTH, targetX } from './combat';
import type { AnimModule } from './types';
import { tl } from './util';

export const stealthLost: AnimModule<'stealth_lost'> = (e, { scene, after }) => {
  const t = tl();
  const x = targetX(scene, e.target);
  t.call(() => {
    sfxAt('combat.stealth', x);
    const p = scene.pointOf(e.target);
    scene.particles.emit('stealth_smoke', { at: { x: p.x, y: 0, z: p.z }, count: STEALTH.leaveSmoke });
    const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
    // 图标那一格要在同步之前取：同步后那一格就擦掉了
    const cell = m?.keywordCell('stealth') ?? null;
    scene.sync(after, 0.1);
    if (m) {
      stealthFadeOut(m, STEALTH.leaveFade);
      keywordStamp(m, 'stealth', cell, 'out', STEALTH.leaveFade * 2);
    }
  });
  hold(t, 0.4, 0);
  return { tl: t, order: x, tail: 0.25 };
};
