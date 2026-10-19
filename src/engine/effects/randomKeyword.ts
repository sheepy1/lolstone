import { findMinion, randomInt, type Ctx } from '../context';
import type { Keyword } from '../state';
import { applyBuff } from './buff';
import type { EffectEnv } from './types';

// 随机获得列表里的一个关键词（乌迪尔），当作一条永久增益记录，沉默会移除。
export function randomKeyword(ctx: Ctx, group: number, env: EffectEnv, from: Keyword[]): void {
  if (env.selfId === null || from.length === 0) return;
  const loc = findMinion(ctx.state, env.selfId);
  if (!loc) return;
  const kw = from[randomInt(ctx, from.length)];
  applyBuff(ctx, group, loc.side, loc.minion, { attack: 0, health: 0, keywords: [kw], duration: 'permanent' }, env.source, 'physical');
}
