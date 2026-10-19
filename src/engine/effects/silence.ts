import { getCard } from '../cardDb';
import { emit, findMinion, type Ctx } from '../context';
import type { SourceRef } from '../events';
import type { Fx, TargetRef } from '../state';

// 沉默（spec 3.3）：移除关键词、卡面效果和所有增减益，攻击力和生命上限回到卡面；
// 当前生命值超过新上限时降到上限；同时解除冻结。受到的伤害保留。
export function silenceTarget(ctx: Ctx, group: number, source: SourceRef, target: TargetRef, fx: Fx): void {
  if (target.kind === 'hero') return;
  const loc = findMinion(ctx.state, target.instanceId);
  if (!loc) return;
  const m = loc.minion;
  const def = getCard(m.cardId);
  const attackBefore = m.attack;
  const healthBefore = m.health;
  const maxHealthBefore = m.maxHealth;
  const keywordsLost = m.keywords;
  const wasFrozen = m.frozenAt !== undefined;
  m.silenced = true;
  m.buffs = [];
  m.keywords = [];
  m.attack = def.attack ?? 0;
  m.maxHealth = def.health ?? 1;
  if (m.health > m.maxHealth) m.health = m.maxHealth;
  delete m.frozenAt;
  emit(ctx, group, {
    kind: 'silence',
    source,
    target,
    attackBefore,
    attackAfter: m.attack,
    healthBefore,
    healthAfter: m.health,
    maxHealthBefore,
    maxHealthAfter: m.maxHealth,
    keywordsLost,
    fx,
  });
  if (wasFrozen) emit(ctx, group, { kind: 'unfreeze', target, reason: 'silence' });
}
