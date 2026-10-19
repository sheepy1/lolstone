// 冻结（m4-storyboard E17，中档；按用户 2026-10-20 的反馈重做，700ms）：
// 0ms：frost_spread 从底座向上，台面上一圈霜纹扩散开（700ms）；
// 100ms：结冰声，冰壳出现：冰棱绕底座一根根长出来（450ms，远侧几根高出头像），头像上的冰面从边缘往里结，
//   贴地冷雾和雪点淡入，两个徽章蒙上薄霜，底座抖两下；
// 550ms：冰晶闪光（整个冰壳亮一下，220ms）加一点冰色火花。
// 常驻：冰壳留着直到解冻（fx/iceShell.ts：反光偶尔闪过、冷雾流动、雪点飘落）。
// 群体冻结按目标从左到右错开 40ms，每个随从的冰棱按实例 id 生成、各不一样，整组棋盘闪一次冰色。
import { boardFlash } from '../fx/screen';
import { FX_PALETTE } from '../fx/particles';
import { frostRing } from '../fx/iceShell';
import { FREEZE, hold, jitter, sfxAt, targetX, UNIT } from './combat';
import type { AnimModule, Cue } from './types';
import { tl } from './util';

export const freeze: AnimModule<'freeze'> = (e, { scene, after }) => {
  const F = FREEZE;
  const t = tl();
  const x = targetX(scene, e.target);
  const m = () => (e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined);
  t.call(() => {
    const p = scene.pointOf(e.target);
    scene.particles.emit('frost_spread', { at: { x: p.x, y: 0, z: p.z }, count: F.spreadCount, dir: 'up' });
    frostRing(scene.layers.fx, p, F.ringRadius, F.ring);
  });
  t.call(
    () => {
      sfxAt('combat.freeze', x);
      scene.sync(after, 0.1);
      const v = m();
      if (!v) return;
      v.ice.grow(F.grow);
      jitter(v.body, F.shakeAmp * UNIT.base, F.shakes, F.shakeTime * F.shakes);
    },
    undefined,
    F.growAt,
  );
  t.call(
    () => {
      const v = m();
      if (!v) return;
      v.ice.flash(F.flash);
      const p = scene.pointOf(e.target);
      scene.particles.emit('spark_light', { at: { x: p.x, y: 0.7, z: p.z - 0.3 }, count: 5, color: FX_PALETTE.ice });
    },
    undefined,
    F.flashAt,
  );
  hold(t, F.total, 0);
  const cues: Cue[] = [{ channel: 'boardflash', at: F.growAt, weight: 1, run: () => {}, many: () => boardFlash(scene, FX_PALETTE.ice) }];
  // 收尾：闪光之后（分镜 1.7 的组间重叠）
  return { tl: t, cues, order: x, stagger: F.stagger, tail: F.total - F.flashAt };
};
