// 沉默（m4-storyboard E16，400ms，轻档）：头像亮度压到 0.5 再 150ms 回来；嘲讽金边、潜行烟、圣盾外壳和护盾环 100ms 内收缩消失；
// 数值回到卡面，变化的徽章弹一下并变红；shadow_gather 紫色向内聚 200ms。声音是消音声 card.silence。
import { FX_PALETTE } from '../fx/particles';
import { stripStatus } from '../fx/statusFx';
import { BUFF, dimPortrait, hold, sfxAt, targetX } from './combat';
import type { AnimModule } from './types';
import { TINT, tl } from './util';

export const silence: AnimModule<'silence'> = (e, { scene, after }) => {
  const B = BUFF;
  const t = tl();
  const x = targetX(scene, e.target);
  const m = () => (e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined);
  t.call(() => {
    sfxAt('card.silence', x);
    const p = scene.pointOf(e.target);
    scene.particles.emit('shadow_gather', { at: { x: p.x, y: 0, z: p.z }, count: B.gather, color: FX_PALETTE.debuff, dir: 'in' });
    const v = m();
    if (v) stripStatus(v, B.strip);
  });
  t.call(
    () => {
      scene.sync(after, 0.05);
      const v = m();
      if (!v) return;
      dimPortrait(v, B.debuffDim, B.debuffBack);
      if (e.attackAfter !== e.attackBefore) v.badges.attack.pop(TINT.debuff);
      if (e.maxHealthAfter !== e.maxHealthBefore || e.healthAfter !== e.healthBefore) v.badges.health.pop(TINT.debuff);
    },
    undefined,
    B.strip,
  );
  hold(t, 0.4, 0);
  // 收尾：状态收掉、徽章弹起之后
  return { tl: t, order: x, stagger: B.stagger, tail: B.silenceTail };
};
