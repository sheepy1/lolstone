// 随从死亡：变灰、缩小碎裂、碎片散开，然后相邻随从合拢。英雄随从说一句禁用语音。
import gsap from 'gsap';
import { playSfx, playVoice } from '../../audio';
import { championOf } from '../../assets/manifest';
import { burst } from '../fx/effects';
import { grayscaleFilter } from '../fx/filters';
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
    if (m) m.body.filters = [grayscaleFilter()];
  });
  if (m) {
    t.to(m.body, { alpha: 0, duration: 0.45, ease: 'power2.in' }, 0.1);
    t.to(m.body.scale, { x: 0.4, y: 0.4, duration: 0.45, ease: 'power2.in' }, 0.1);
  }
  t.add(burst(scene.layers.fx, where, 0x909090, 22, 0.5), 0.2);
  t.add(syncTo(scene, after, 0.3), 0.5);
  return { tl: t };
};
