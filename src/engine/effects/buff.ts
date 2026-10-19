import { getCard } from '../cardDb';
import { emit, minionRef, type Ctx } from '../context';
import type { SourceRef } from '../events';
import { staticEffects } from '../keywords';
import type { Buff, Fx, Keyword, MinionState, Side } from '../state';

type BuffSpec = {
  attack: number;
  health: number;
  keywords: Keyword[];
  duration: 'permanent' | 'turn';
};

// 给随从加一条增减益（spec 3.4 buff）。攻击力最低压到 0；生命值和上限一起加减，
// 减到小于等于 0 的随从在随后的死亡结算中死亡。
export function applyBuff(
  ctx: Ctx,
  group: number,
  side: Side,
  m: MinionState,
  spec: BuffSpec,
  source: SourceRef | null,
  fx: Fx,
  reason: 'effect' | 'enrage' = 'effect',
): void {
  const attackBefore = m.attack;
  const healthBefore = m.health;
  const maxHealthBefore = m.maxHealth;
  m.attack = Math.max(0, m.attack + spec.attack);
  m.maxHealth += spec.health;
  m.health += spec.health;
  const gained = spec.keywords.filter((k, i) => !m.keywords.includes(k) && spec.keywords.indexOf(k) === i);
  m.keywords = [...m.keywords, ...gained];
  const buff: Buff = {
    source: source && 'instanceId' in source ? source.instanceId : null,
    sourceCardId: source && 'cardId' in source ? source.cardId : null,
    attack: m.attack - attackBefore,
    health: spec.health,
    keywords: [...spec.keywords],
    duration: spec.duration,
  };
  if (reason === 'enrage') {
    buff.source = null;
    buff.enrage = true;
  }
  m.buffs = [...m.buffs, buff];
  emit(ctx, group, {
    kind: 'buff',
    source,
    target: minionRef(side, m),
    reason,
    attack: buff.attack,
    health: buff.health,
    keywords: gained,
    keywordsLost: [],
    duration: spec.duration,
    attackBefore,
    attackAfter: m.attack,
    healthBefore,
    healthAfter: m.health,
    maxHealthBefore,
    maxHealthAfter: m.maxHealth,
    fx,
  });
  if (reason !== 'enrage') updateEnrage(ctx, group, side, m);
}

// 移除一条增减益（本回合增益到期、激怒失效），按记下的变化量反向扣回。
export function removeBuff(
  ctx: Ctx,
  group: number,
  side: Side,
  m: MinionState,
  buff: Buff,
  reason: 'expire' | 'enrage',
): void {
  const attackBefore = m.attack;
  const healthBefore = m.health;
  const maxHealthBefore = m.maxHealth;
  m.buffs = m.buffs.filter((b) => b !== buff);
  m.attack = Math.max(0, m.attack - buff.attack);
  m.maxHealth -= buff.health;
  if (buff.health > 0) m.health = Math.min(m.health, m.maxHealth);
  else m.health -= buff.health;
  const lost = buff.keywords.filter((k) => m.keywords.includes(k) && !keywordStillProvided(m, k));
  m.keywords = m.keywords.filter((k) => !lost.includes(k));
  emit(ctx, group, {
    kind: 'buff',
    source: null,
    target: minionRef(side, m),
    reason,
    attack: m.attack - attackBefore,
    health: m.maxHealth - maxHealthBefore,
    keywords: [],
    keywordsLost: lost,
    duration: buff.duration,
    attackBefore,
    attackAfter: m.attack,
    healthBefore,
    healthAfter: m.health,
    maxHealthBefore,
    maxHealthAfter: m.maxHealth,
    fx: 'physical',
  });
}

// 关键词在移除一条增益之后是否仍由卡面或别的增益提供。
function keywordStillProvided(m: MinionState, k: Keyword): boolean {
  if (!m.silenced && (getCard(m.cardId).keywords ?? []).includes(k)) return true;
  return m.buffs.some((b) => b.keywords.includes(k));
}

// 激怒（spec 3.3）：生命值低于上限时获得效果，恢复满就失去。每次生命值变化后调用。
export function updateEnrage(ctx: Ctx, group: number, side: Side, m: MinionState): void {
  const enrage = staticEffects(m).find((e) => e.kind === 'enrage');
  const active = m.buffs.find((b) => b.enrage);
  if (!enrage || enrage.kind !== 'enrage') return;
  const damaged = m.health < m.maxHealth;
  if (damaged && !active) {
    applyBuff(
      ctx,
      group,
      side,
      m,
      { attack: enrage.attack ?? 0, health: enrage.health ?? 0, keywords: enrage.keywords ?? [], duration: 'permanent' },
      { kind: 'minion', side, instanceId: m.instanceId, cardId: m.cardId },
      'fire',
      'enrage',
    );
  } else if (!damaged && active) {
    removeBuff(ctx, group, side, m, active, 'enrage');
  }
}

// 回合结束时移除双方场上所有"本回合"的增益（spec 2.3 第 5 步）。
export function expireTurnBuffs(ctx: Ctx, group: number): void {
  for (const side of [0, 1] as const) {
    for (const m of ctx.state.players[side].board) {
      for (const b of m.buffs.filter((x) => x.duration === 'turn')) {
        removeBuff(ctx, group, side, m, b, 'expire');
      }
    }
  }
}

