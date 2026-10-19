// 随从入场：从手牌打出的落地时弹一下、脚下扬起尘土，相邻随从让位，英雄说登场台词；
// 效果和英雄技能召唤的衍生物从光点凝聚成形。
import { playSfx, playVoice } from '../../audio';
import { championOf } from '../../assets/manifest';
import { burst, ring } from '../fx/effects';
import type { AnimModule } from './types';
import { flash, pointOf, syncTo, tl } from './util';

export const minionSummoned: AnimModule<'minion_summoned'> = (e, { scene, after }) => {
  const t = tl();
  const where = pointOf(scene, e.target);
  t.add(syncTo(scene, after, 0.35));
  if (e.via === 'play') {
    t.call(() => {
      playSfx('card.land');
      const champ = championOf(e.cardId);
      if (champ) playVoice(champ, 'choose');
    }, undefined, 0.15);
    t.add(burst(scene.layers.fx, () => ({ ...where(), y: 0.05 }), 0x9a8060, 16, 0.45), 0.15);
  } else {
    t.call(() => playSfx('combat.summon'), undefined, 0);
    t.add(ring(scene.layers.fx, where, 0xfff1a0, 90, 0.45), 0);
    t.call(() => {
      const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
      if (m) flash(m.flash, 0xffffff, 0.9, 0.35);
    }, undefined, 0.05);
  }
  return { tl: t };
};
