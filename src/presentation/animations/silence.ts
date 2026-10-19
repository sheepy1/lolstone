// 沉默：头像暗一下，关键词图标和描边消失，数值回到卡面，变化的徽章弹一下。
import { playSfx } from '../../audio';
import { floatText } from '../fx/effects';
import type { AnimModule } from './types';
import { flash, pointOf, popStat, syncTo, TINT, tl } from './util';

export const silence: AnimModule<'silence'> = (e, { scene, after }) => {
  const t = tl();
  const body = scene.targetBody(e.target);
  t.call(() => playSfx('card.debuff'));
  if (body) t.add(flash(body.flash, 0x202030, 0.85, 0.4), 0);
  t.add(floatText(scene.layers.fx, pointOf(scene, e.target), '沉默', 0xc0c0d0, 34), 0);
  t.add(syncTo(scene, after, 0.05), 0.15);
  if (e.attackAfter !== e.attackBefore) t.add(popStat(scene, e.target, 'attack', TINT.debuff), 0.2);
  if (e.maxHealthAfter !== e.maxHealthBefore || e.healthAfter !== e.healthBefore) t.add(popStat(scene, e.target, 'health', TINT.debuff), 0.2);
  return { tl: t };
};
