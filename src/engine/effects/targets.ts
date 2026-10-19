import { findMinion, isDoomed, isRefAlive, randomInt, type Ctx } from '../context';
import { other, type ActionTarget, type MinionState, type Side, type TargetRef } from '../state';
import type { EffectEnv } from './types';

// 自动目标（ActionTarget，spec 3.4）解析成具体的角色列表。
// 群体目标的顺序：友方在前，各自从左到右。群体目标包括本次效果里已经将死、还没离场的随从。
// 随机目标只从没有将死的随从里选。
export function resolveActionTargets(ctx: Ctx, env: EffectEnv, target: ActionTarget): TargetRef[] {
  const state = ctx.state;
  const side = env.side;
  const enemy = other(side);
  const refs = (s: Side, list: MinionState[]): TargetRef[] =>
    list.map((m) => ({ side: s, kind: 'minion', instanceId: m.instanceId }));
  const friendly = state.players[side].board;
  const enemies = state.players[enemy].board;

  switch (target) {
    case 'chosen':
      return env.chosen && isRefAlive(state, env.chosen) ? [env.chosen] : [];
    case 'self': {
      if (env.selfId === null) return [];
      const loc = findMinion(state, env.selfId);
      return loc ? [{ side: loc.side, kind: 'minion', instanceId: env.selfId }] : [];
    }
    case 'friendly_hero':
      return [{ side, kind: 'hero' }];
    case 'enemy_hero':
      return [{ side: enemy, kind: 'hero' }];
    case 'all_enemy_minions':
      return refs(enemy, enemies);
    case 'all_minions':
      return [...refs(side, friendly), ...refs(enemy, enemies)];
    // 法术没有"本随从"，这时就是所有友方随从（集结用它）
    case 'other_friendly_minions':
      return refs(
        side,
        friendly.filter((m) => m.instanceId !== env.selfId),
      );
    case 'random_enemy_minion':
      return pickRandom(ctx, refs(enemy, enemies.filter((m) => !isDoomed(m))));
    case 'random_other_friendly_minion':
      return pickRandom(
        ctx,
        refs(
          side,
          friendly.filter((m) => m.instanceId !== env.selfId && !isDoomed(m)),
        ),
      );
  }
}

function pickRandom(ctx: Ctx, list: TargetRef[]): TargetRef[] {
  if (list.length === 0) return [];
  return [list[randomInt(ctx, list.length)]];
}
