// 冻结（m4-storyboard E17，500ms，中档）：
// 扩散 200ms（线）：frost_spread 从底座向上；
// 覆冰 300ms（落）：冰层从底座向头像上升（裁切 0 → 1），冰面闪一下高光，两个徽章蒙上淡蓝，底座抖两下；
// 常驻：冰层留着直到解冻。结冰声在覆冰 t=0。群体冻结按目标从左到右错开 40ms，整组棋盘闪一次冰色。
import { boardFlash } from '../fx/screen';
import { FX_PALETTE } from '../fx/particles';
import { iceRise } from '../fx/statusFx';
import { FREEZE, hold, jitter, sfxAt, targetX, UNIT } from './combat';
import type { AnimModule, Cue } from './types';
import { flash, tl } from './util';

export const freeze: AnimModule<'freeze'> = (e, { scene, after }) => {
  const F = FREEZE;
  const t = tl();
  const x = targetX(scene, e.target);
  t.call(() => {
    const p = scene.pointOf(e.target);
    scene.particles.emit('frost_spread', { at: { x: p.x, y: 0, z: p.z }, count: F.spreadCount, dir: 'up' });
  });
  t.call(
    () => {
      sfxAt('combat.freeze', x);
      scene.sync(after, 0.1);
      const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
      if (!m) return;
      iceRise(m, F.coat);
      flash(m.flash, FX_PALETTE.ice, 0.7, F.coat);
      jitter(m.body, F.shakeAmp * UNIT.base, F.shakes, F.shakeTime * F.shakes);
    },
    undefined,
    F.spread,
  );
  hold(t, F.spread + F.coat, 0);
  const cues: Cue[] = [{ channel: 'boardflash', at: F.spread, weight: 1, run: () => {}, many: () => boardFlash(scene, FX_PALETTE.ice) }];
  return { tl: t, cues, order: x, stagger: F.stagger };
};
