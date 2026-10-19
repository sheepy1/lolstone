// 需要玩家选的目标（TargetSpec，spec 3.4）的合法范围。
import { hasKeyword } from './keywords';
import {
  other,
  type CardDef,
  type GameState,
  type MinionState,
  type Side,
  type TargetRef,
  type TargetSpec,
  type TriggeredEffect,
} from './state';

// 合法目标的顺序：友方英雄、敌方英雄、友方随从（从左到右）、敌方随从（从左到右）。
// selfId 是发起效果的随从，other_friendly_minion 要排除它。
export function pickTargets(state: GameState, side: Side, spec: TargetSpec, selfId: number | null): TargetRef[] {
  const enemy = other(side);
  const friendlyMinions = state.players[side].board;
  const enemyMinions = state.players[enemy].board.filter((m) => !hasKeyword(m, 'stealth'));
  const damagedOnly = spec.where?.damaged === true;
  const keepMinion = (m: MinionState) => !damagedOnly || m.health < m.maxHealth;
  const keepHero = (s: Side) => !damagedOnly || state.players[s].hero.health < state.players[s].hero.maxHealth;
  const mins = (s: Side, list: MinionState[]): TargetRef[] =>
    list.filter(keepMinion).map((m) => ({ side: s, kind: 'minion', instanceId: m.instanceId }));
  const heroes = (): TargetRef[] =>
    ([side, enemy] as Side[]).filter(keepHero).map((s) => ({ side: s, kind: 'hero' }));

  switch (spec.pick) {
    case 'any_character':
      return [...heroes(), ...mins(side, friendlyMinions), ...mins(enemy, enemyMinions)];
    case 'any_minion':
      return [...mins(side, friendlyMinions), ...mins(enemy, enemyMinions)];
    case 'enemy_minion':
      return mins(enemy, enemyMinions);
    case 'friendly_minion':
      return mins(side, friendlyMinions);
    case 'other_friendly_minion':
      return mins(
        side,
        friendlyMinions.filter((m) => m.instanceId !== selfId),
      );
  }
}

// 从手牌打出（或使用英雄技能）时需要玩家选目标的那个效果。
// 卡池校验保证一张卡最多一个效果声明 target。连击只在条件满足时算。
export function playTargetEffect(def: CardDef, comboActive: boolean): TriggeredEffect | null {
  for (const e of def.effects ?? []) {
    if (e.trigger === 'static' || !e.target) continue;
    if (e.trigger === 'cast' || e.trigger === 'battlecry') return e;
    if (e.trigger === 'combo' && comboActive) return e;
  }
  return null;
}

export function sameRef(a: TargetRef | null | undefined, b: TargetRef | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.side !== b.side || a.kind !== b.kind) return false;
  return a.kind === 'hero' || (b.kind === 'minion' && a.instanceId === b.instanceId);
}
