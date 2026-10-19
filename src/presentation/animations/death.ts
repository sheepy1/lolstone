// 随从死亡：变灰、沉下缩小、碎片散开，然后相邻随从合拢。英雄随从说一句禁用语音。
import { playSfx, playVoice } from '../../audio';
import { championOf } from '../../assets/manifest';
import { burst } from '../fx/effects';
import type { AnimModule } from './types';
import { pointOf, syncTo, tl } from './util';

export const death: AnimModule<'death'> = (e, { scene, after }) => {
  const t = tl();
  const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
  const where = pointOf(scene, e.target);
  t.call(() => {
    playSfx('combat.death');
    const champ = championOf(e.cardId);
    if (champ) playVoice(champ, 'ban');
    m?.setDead();
  });
  if (m) {
    t.to(m.body.scale, { x: 0.3, y: 0.05, z: 0.3, duration: 0.45, ease: 'power2.in' }, 0.1);
    t.to(m.body.rotation, { y: 0.6, duration: 0.45, ease: 'power2.in' }, 0.1);
  }
  t.add(burst(scene.layers.fx, where, 0xa0a0a0, 26, 0.5), 0.2);
  t.add(syncTo(scene, after, 0.3), 0.5);
  return { tl: t };
};
