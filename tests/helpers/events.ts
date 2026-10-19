// 事件完整性检查（spec 6.7）：每种事件的字段表。字段缺失、多出或值为 undefined 都算不齐。
import { expect } from 'vitest';
import type { EventOf, GameEvent, GameEventKind } from '../../src/engine';

type FieldTable = { [K in GameEventKind]: readonly Exclude<keyof EventOf<K>, 'kind' | 'group'>[] };

export const EVENT_FIELDS: FieldTable = {
  mulligan_start: ['first', 'hands'],
  mulligan_done: ['side', 'replaced', 'drawn'],
  game_start: ['first'],
  turn_start: ['side', 'turn'],
  turn_end: ['side', 'turn'],
  draw: ['side', 'card', 'handIndex'],
  burn: ['side', 'card'],
  fatigue: ['side', 'amount'],
  card_played: ['side', 'card', 'cardType', 'handIndex', 'cost', 'position', 'target'],
  minion_summoned: ['side', 'target', 'cardId', 'position', 'via', 'attack', 'health', 'source', 'fx'],
  spell_cast: ['side', 'card', 'target'],
  hero_power_used: ['side', 'cardId', 'target'],
  trigger: ['source', 'timing', 'target', 'script'],
  attack: ['attacker', 'target'],
  damage: ['source', 'target', 'amount', 'shieldAbsorbed', 'healthBefore', 'healthAfter', 'lethalPrevented', 'fx'],
  heal: ['source', 'target', 'amount', 'healthBefore', 'healthAfter', 'fx'],
  death: ['target', 'cardId', 'position'],
  buff: [
    'source', 'target', 'reason', 'attack', 'health', 'keywords', 'keywordsLost', 'duration',
    'attackBefore', 'attackAfter', 'healthBefore', 'healthAfter', 'maxHealthBefore', 'maxHealthAfter', 'fx',
  ],
  silence: [
    'source', 'target', 'attackBefore', 'attackAfter', 'healthBefore', 'healthAfter',
    'maxHealthBefore', 'maxHealthAfter', 'keywordsLost', 'fx',
  ],
  freeze: ['source', 'target', 'frozenAt', 'fx'],
  unfreeze: ['target', 'reason'],
  shield_broken: ['target'],
  stealth_lost: ['target'],
  bounce: ['source', 'target', 'cardId', 'position', 'handIndex', 'destroyed', 'card', 'fx'],
  transform: ['source', 'target', 'cardId', 'into', 'newTarget', 'position', 'attack', 'health', 'fx'],
  mana_changed: ['side', 'before', 'after', 'reason'],
  game_over: ['winner'],
};

export function expectEventShape(e: GameEvent): void {
  const expected = ['kind', 'group', ...EVENT_FIELDS[e.kind]].sort();
  expect(Object.keys(e).sort(), `fields of ${e.kind}`).toEqual(expected);
  for (const [k, v] of Object.entries(e)) expect(v, `${e.kind}.${k}`).not.toBeUndefined();
  expect(typeof e.group).toBe('number');
}

// 找到第一个该类型的事件，并检查字段齐全。
export function expectEvent<K extends GameEventKind>(events: GameEvent[], kind: K): EventOf<K> {
  const e = events.find((x): x is EventOf<K> => x.kind === kind);
  expect(e, `expected a ${kind} event in [${events.map((x) => x.kind).join(', ')}]`).toBeDefined();
  expectEventShape(e!);
  return e!;
}
