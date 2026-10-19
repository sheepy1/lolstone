// 效果执行：按顺序执行一个效果的动作列表（spec 3.4）。死亡结算由调用方在效果执行完之后做。
import { findMinion, newGroup, type Ctx } from '../context';
import { spellDamage } from '../keywords';
import type { EffectAction, MinionState } from '../state';
import { applyBuff } from './buff';
import { bounceTarget } from './bounce';
import { dealDamage } from './damage';
import { destroyTarget } from './destroy';
import { drawCard } from './draw';
import { extraAttack } from './extraAttack';
import { freezeTarget } from './freeze';
import { gainMana } from './gainMana';
import { healCharacter } from './heal';
import { randomKeyword } from './randomKeyword';
import { silenceTarget } from './silence';
import { summonTokens } from './summon';
import { resolveActionTargets } from './targets';
import { transformTarget } from './transform';
import type { EffectEnv } from './types';

export type { EffectEnv } from './types';

export function runActions(ctx: Ctx, env: EffectEnv, actions: readonly EffectAction[]): void {
  for (const action of actions) {
    if (ctx.state.phase === 'over') return;
    runAction(ctx, env, action);
  }
}

// 造成伤害的随从：还在场上就取场上的，已离场（亡语）取快照。
function sourceMinion(ctx: Ctx, env: EffectEnv): MinionState | null {
  if (env.selfId === null) return null;
  return findMinion(ctx.state, env.selfId)?.minion ?? env.selfSnapshot;
}

function runAction(ctx: Ctx, env: EffectEnv, action: EffectAction): void {
  // 一个动作打到的所有目标共用一个 group，表现层并行播放
  const group = newGroup(ctx);
  switch (action.kind) {
    case 'damage': {
      const amount = action.amount + (env.isSpell ? spellDamage(ctx.state, env.side) : 0);
      const src = sourceMinion(ctx, env);
      for (const t of resolveActionTargets(ctx, env, action.target)) {
        dealDamage(ctx, group, env.source, src, t, amount, action.fx, action.fxId);
      }
      return;
    }
    case 'heal':
      for (const t of resolveActionTargets(ctx, env, action.target)) {
        healCharacter(ctx, group, env.source, t, action.amount, action.fx, action.fxId);
      }
      return;
    case 'buff':
      for (const t of resolveActionTargets(ctx, env, action.target)) {
        if (t.kind !== 'minion') continue;
        const loc = findMinion(ctx.state, t.instanceId);
        if (!loc) continue;
        applyBuff(
          ctx,
          group,
          loc.side,
          loc.minion,
          {
            attack: action.attack ?? 0,
            health: action.health ?? 0,
            keywords: action.keywords ?? [],
            duration: action.duration,
          },
          env.source,
          action.fx,
          'effect',
          action.fxId,
        );
      }
      return;
    case 'summon':
      summonTokens(ctx, group, env, action.token, action.count, action.fx, action.fxId);
      return;
    case 'draw':
      for (let i = 0; i < action.count; i++) drawCard(ctx, group, env.side);
      return;
    case 'freeze':
      for (const t of resolveActionTargets(ctx, env, action.target)) freezeTarget(ctx, group, env.source, t, action.fx, action.fxId);
      return;
    case 'silence':
      for (const t of resolveActionTargets(ctx, env, action.target)) silenceTarget(ctx, group, env.source, t, action.fx, action.fxId);
      return;
    case 'destroy':
      for (const t of resolveActionTargets(ctx, env, action.target)) destroyTarget(ctx, t, action.fx, action.fxId);
      return;
    case 'bounce':
      for (const t of resolveActionTargets(ctx, env, action.target)) bounceTarget(ctx, group, env.source, t, action.fx, action.fxId);
      return;
    case 'transform':
      for (const t of resolveActionTargets(ctx, env, action.target)) {
        transformTarget(ctx, group, env.source, t, action.into, action.fx, action.fxId);
      }
      return;
    case 'gain_mana':
      gainMana(ctx, group, env.side, action.mode, action.amount);
      return;
    case 'extra_attack':
      extraAttack(ctx, env);
      return;
    case 'random_keyword':
      randomKeyword(ctx, group, env, action.from);
      return;
  }
}
