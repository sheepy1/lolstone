// 不变量检查（spec 6.7）：每次 applyAction 之后检查，测试模式下打开，违反时抛错（这是引擎的 bug）。
import { MAX_BOARD, MAX_HAND, MAX_MANA, type GameState } from './state';

let enabled = typeof process !== 'undefined' && process.env?.MELOL_INVARIANTS === '1';

export function setInvariantChecks(on: boolean): void {
  enabled = on;
}

export function invariantChecksEnabled(): boolean {
  return enabled;
}

export function findInvariantViolations(state: GameState): string[] {
  const errors: string[] = [];
  state.players.forEach((p, side) => {
    const tag = `player ${side}`;
    if (p.hero.health > p.hero.maxHealth) errors.push(`${tag}: hero health ${p.hero.health} > max ${p.hero.maxHealth}`);
    if (p.board.length > MAX_BOARD) errors.push(`${tag}: board has ${p.board.length} minions`);
    if (p.hand.length > MAX_HAND) errors.push(`${tag}: hand has ${p.hand.length} cards`);
    const { max, current, temp } = p.mana;
    if (max < 0 || max > MAX_MANA) errors.push(`${tag}: mana max ${max} out of range`);
    if (current < 0 || current > MAX_MANA) errors.push(`${tag}: mana current ${current} out of range`);
    if (temp < 0 || temp > current) errors.push(`${tag}: temp mana ${temp} out of range`);
    for (const m of p.board) {
      const id = `${tag} minion ${m.instanceId}(${m.cardId})`;
      if (m.health > m.maxHealth) errors.push(`${id}: health ${m.health} > max ${m.maxHealth}`);
      if (m.attack < 0) errors.push(`${id}: attack ${m.attack} < 0`);
      if (state.phase !== 'over' && (m.health <= 0 || m.pendingDestroy)) errors.push(`${id}: dead minion left on board`);
    }
  });
  const ids = [
    ...state.players.flatMap((p) => [...p.deck, ...p.hand].map((c) => c.instanceId)),
    ...state.players.flatMap((p) => p.board.map((m) => m.instanceId)),
  ];
  if (new Set(ids).size !== ids.length) errors.push('duplicate instance ids');
  return errors;
}

export function assertInvariants(state: GameState): void {
  const errors = findInvariantViolations(state);
  if (errors.length > 0) throw new Error(`invariant violated:\n${errors.join('\n')}`);
}
