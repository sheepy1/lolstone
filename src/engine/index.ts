// 引擎对外接口。
export * from './state';
export type { GameEvent, GameEventKind, EventOf, SourceRef, ManaSnapshot, TriggerTiming } from './events';
export { ENGINE_EVENT_KINDS } from './events';
export { type Action, listLegalActions, actionKey, checkAction, checkActionShape } from './actions';
export { applyAction, type ApplyResult } from './game';
export { createGame, type CreateGameOptions } from './setup';
export { maskEvents, maskHidden, visibleState } from './mask';
export { forkRng, seedRng, nextFloat, nextInt, shuffle } from './rng';
export { installCardPool, getCard, findCard, getHeroClass, allCards, allHeroClasses } from './cardDb';
export { setInvariantChecks, findInvariantViolations, assertInvariants } from './invariants';
export { SCRIPTS } from './scripts';
export { canAttack, hasKeyword, spellDamage } from './keywords';
