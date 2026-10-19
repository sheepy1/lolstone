// 圣盾被打破（m4-storyboard E18 打破，命中帧，中档）：shield_break 向外迸开，发光外壳裂成 6 片飞散 250ms，
// 生命徽章外圈的护盾环放大熄灭，随从处白闪 60ms（不是全屏）。"吸收"白字由受伤事件弹。破盾声在命中帧。
// 它替代了本该出现的受伤反馈，所以分量不比受伤轻：粒子、碎片、白闪、声音四个通道。
import { shieldShatter } from '../fx/statusFx';
import { hold, SHIELD, sfxAt, targetX } from './combat';
import type { AnimModule, Cue } from './types';
import { flash, syncTo, tl } from './util';

export const shieldBroken: AnimModule<'shield_broken'> = (e, { scene, after }) => {
  const S = SHIELD;
  const t = tl();
  const x = targetX(scene, e.target);
  t.call(() => {
    const p = scene.pointOf(e.target);
    scene.particles.emit('shield_break', { at: { x: p.x, y: 0.3, z: p.z }, count: S.breakCount });
    const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
    if (!m) return;
    shieldShatter(scene.layers.fx, m, S.shardTime, S.shardSpeed);
    flash(m.flash, 0xffffff, 0.9, S.whiteFlash);
  });
  t.add(syncTo(scene, after, 0.1), S.shardTime);
  hold(t, 0.4, 0);
  const cues: Cue[] = [{ channel: 'impact:shield', at: 0, weight: 1, run: () => sfxAt('combat.shield_break', x) }];
  return { tl: t, cues, order: x, stagger: 0.04 };
};
