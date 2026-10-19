// 关键词判定（spec 2.5、3.3）。只读局面，不改。
import { getCard } from './cardDb';
import {
  other,
  type Effect,
  type GameState,
  type Keyword,
  type MinionState,
  type Side,
  type StaticEffect,
  type TargetRef,
  type TriggeredEffect,
  type TriggeredTiming,
} from './state';

export function hasKeyword(m: MinionState, kw: Keyword): boolean {
  return m.keywords.includes(kw);
}

// 随从当前生效的卡面效果。被沉默后一律没有。
export function activeEffects(m: MinionState): Effect[] {
  if (m.silenced) return [];
  return getCard(m.cardId).effects ?? [];
}

export function triggeredEffects(m: MinionState, timing: TriggeredTiming): TriggeredEffect[] {
  return activeEffects(m).filter((e): e is TriggeredEffect => e.trigger === timing);
}

export function staticEffects(m: MinionState): StaticEffect[] {
  return activeEffects(m).filter((e): e is StaticEffect => e.trigger === 'static');
}

// 法术伤害 +X：己方场上所有随从的法术伤害加总。
export function spellDamage(state: GameState, side: Side): number {
  let total = 0;
  for (const m of state.players[side].board) {
    for (const e of staticEffects(m)) {
      if (e.kind === 'spell_damage') total += e.amount;
    }
  }
  return total;
}

export function isFrozen(m: MinionState): boolean {
  return m.frozenAt !== undefined;
}

// 本回合入场且没有冲锋：突袭的只能打随从，没突袭的不能攻击。
function isSummonSick(state: GameState, m: MinionState): boolean {
  return m.enteredTurn >= state.turn && !hasKeyword(m, 'charge');
}

export function maxAttacks(m: MinionState): number {
  return (hasKeyword(m, 'windfury') ? 2 : 1) + m.extraAttacks;
}

// spec 2.5 能攻击的条件。只判断随从本身，不看是否轮到它的拥有者。
export function canAttack(state: GameState, m: MinionState): boolean {
  if (m.attack <= 0) return false;
  if (isFrozen(m)) return false;
  if (isSummonSick(state, m) && !hasKeyword(m, 'rush')) return false;
  return m.attacksThisTurn < maxAttacks(m);
}

// 攻击目标（spec 2.5）：嘲讽优先，潜行不能被攻击，突袭入场当回合不能打英雄。
export function attackTargets(state: GameState, side: Side, attacker: MinionState): TargetRef[] {
  const enemy = other(side);
  const visible = state.players[enemy].board.filter((m) => !hasKeyword(m, 'stealth'));
  const taunts = visible.filter((m) => hasKeyword(m, 'taunt'));
  const minions = taunts.length > 0 ? taunts : visible;
  const out: TargetRef[] = minions.map((m) => ({ side: enemy, kind: 'minion', instanceId: m.instanceId }));
  const rushOnly = isSummonSick(state, attacker);
  if (taunts.length === 0 && !rushOnly) out.unshift({ side: enemy, kind: 'hero' });
  return out;
}
