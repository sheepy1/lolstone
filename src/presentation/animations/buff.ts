// 增益 / 减益：头像绕一圈金光（减益时暗一下），变化的徽章弹一下，数值变绿或变红。
import { playSfx } from '../../audio';
import { KEYWORD_NAMES } from '../keywordText';
import { floatText, ring } from '../fx/effects';
import type { AnimModule } from './types';
import { flash, pointOf, popStat, syncTo, TINT, tl } from './util';


const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export const buff: AnimModule<'buff'> = (e, { scene, after }) => {
  const t = tl();
  const where = pointOf(scene, e.target);
  const positive = e.attack + e.health > 0 || (e.attack + e.health === 0 && e.keywords.length > 0);
  const color = positive ? 0x60ff70 : 0xff5050;
  const body = scene.targetBody(e.target);
  t.call(() => playSfx(positive ? 'card.buff' : 'card.debuff'));
  t.add(ring(scene.layers.fx, where, positive ? 0xffd040 : 0x6040a0, 80, 0.35), 0);
  if (body) t.add(flash(body.flash, positive ? 0xffe070 : 0x302040, 0.6, 0.35), 0);
  const parts: string[] = [];
  if (e.attack !== 0 || e.health !== 0) parts.push(`${signed(e.attack)}/${signed(e.health)}`);
  if (e.keywords.length > 0) parts.push(e.keywords.map((k) => KEYWORD_NAMES[k]).join(' '));
  if (e.keywordsLost.length > 0) parts.push(`失去${e.keywordsLost.map((k) => KEYWORD_NAMES[k]).join(' ')}`);
  if (e.reason === 'enrage') parts.unshift('激怒');
  if (parts.length > 0) t.add(floatText(scene.layers.fx, where, parts.join(' '), color, 32), 0);
  // 数值先同步到增益后的值，再让变化的徽章弹一下
  t.add(syncTo(scene, after, 0.05), 0.15);
  if (e.attack !== 0) t.add(popStat(scene, e.target, 'attack', e.attack > 0 ? TINT.buff : TINT.debuff), 0.2);
  if (e.health !== 0 || e.maxHealthAfter !== e.maxHealthBefore) t.add(popStat(scene, e.target, 'health', e.health >= 0 ? TINT.buff : TINT.debuff), 0.2);
  return { tl: t };
};
