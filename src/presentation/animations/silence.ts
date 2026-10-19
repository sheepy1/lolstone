// 沉默：头像暗一下，关键词图标和描边消失，数值回到卡面。
import { playSfx } from '../../audio';
import { floatText } from '../fx/effects';
import type { AnimModule } from './types';
import { flash, pointOf, syncTo, tl } from './util';

export const silence: AnimModule<'silence'> = (e, { scene, after }) => {
  const t = tl();
  const body = scene.targetBody(e.target);
  t.call(() => playSfx('card.debuff'));
  if (body) t.add(flash(body.flash, 0x202030, 0.85, 0.4), 0);
  t.add(floatText(scene.layers.fx, pointOf(scene, e.target), '沉默', 0xc0c0d0, 34), 0);
  t.add(syncTo(scene, after, 0.1), 0.2);
  return { tl: t };
};
