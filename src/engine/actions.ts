// 玩家动作（spec 6.5）和合法性枚举（spec 4.5）。
import { findCard, getCard, getHeroClass } from './cardDb';
import { attackTargets, canAttack } from './keywords';
import {
  HERO_POWER_COST,
  HIDDEN_CARD_ID,
  MANA_POTION_ID,
  MAX_BOARD,
  type CardDef,
  type GameState,
  type Side,
  type TargetRef,
} from './state';
import { pickTargets, playTargetEffect } from './targeting';

export type Action =
  // 换牌阶段。player 是 spec 6.5 之外补的字段：换牌阶段双方都能行动，要标明是谁。
  | { kind: 'mulligan'; player: Side; replace: number[] }
  | { kind: 'play_card'; handIndex: number; position?: number; target?: TargetRef }
  | { kind: 'attack'; attacker: TargetRef; target: TargetRef }
  | { kind: 'hero_power'; target?: TargetRef }
  | { kind: 'end_turn' };

// 列出某一方当前所有合法动作，含出牌的每种目标和位置组合。不是这一方行动时返回空数组。
export function listLegalActions(state: GameState, side: Side): Action[] {
  if (state.phase === 'over') return [];
  const p = state.players[side];
  if (state.phase === 'mulligan') {
    if (p.mulliganDone) return [];
    return mulliganOptions(state, side).map((replace) => ({ kind: 'mulligan', player: side, replace }));
  }
  if (state.current !== side) return [];

  const out: Action[] = [];
  const comboActive = p.cardsPlayedThisTurn > 0;
  p.hand.forEach((card, handIndex) => {
    if (card.cardId === HIDDEN_CARD_ID) return;
    const def = getCard(card.cardId);
    if (def.cost > p.mana.current) return;
    if (def.type === 'minion') {
      if (p.board.length >= MAX_BOARD) return;
      const eff = playTargetEffect(def, comboActive);
      // 需要目标的战吼没有合法目标时随从照常入场，不带目标
      const targets = eff?.target ? pickTargets(state, side, eff.target, null) : [];
      for (let position = 0; position <= p.board.length; position++) {
        if (targets.length === 0) out.push({ kind: 'play_card', handIndex, position });
        else for (const target of targets) out.push({ kind: 'play_card', handIndex, position, target });
      }
    } else if (def.type === 'spell') {
      for (const target of castTargets(state, side, def)) {
        out.push(target ? { kind: 'play_card', handIndex, target } : { kind: 'play_card', handIndex });
      }
    }
  });

  if (!p.heroPowerUsed && p.mana.current >= HERO_POWER_COST) {
    const def = getCard(getHeroClass(p.heroClass).heroPower);
    for (const target of castTargets(state, side, def)) {
      out.push(target ? { kind: 'hero_power', target } : { kind: 'hero_power' });
    }
  }

  for (const m of p.board) {
    if (!canAttack(state, m)) continue;
    const attacker: TargetRef = { side, kind: 'minion', instanceId: m.instanceId };
    for (const target of attackTargets(state, side, m)) out.push({ kind: 'attack', attacker, target });
  }

  out.push({ kind: 'end_turn' });
  return out;
}

// 法术和英雄技能能用的目标。返回 [null] 表示不需要目标、可以使用；返回空数组表示不能用。
function castTargets(state: GameState, side: Side, def: CardDef): (TargetRef | null)[] {
  const effects = (def.effects ?? []).filter((e) => e.trigger === 'cast');
  // 效果只有召唤、场上又满了，就不能用（spec 2.9）
  const actions = effects.flatMap((e) => (e.trigger === 'static' ? [] : e.actions));
  if (actions.length > 0 && actions.every((a) => a.kind === 'summon') && state.players[side].board.length >= MAX_BOARD) {
    return [];
  }
  const eff = playTargetEffect(def, false);
  if (!eff?.target) return [null];
  return pickTargets(state, side, eff.target, null);
}

// 换牌可选的所有组合：法力药水不能换。
function mulliganOptions(state: GameState, side: Side): number[][] {
  const hand = state.players[side].hand;
  const indexes = hand.map((c, i) => (c.cardId === MANA_POTION_ID ? -1 : i)).filter((i) => i >= 0);
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << indexes.length; mask++) {
    out.push(indexes.filter((_, bit) => mask & (1 << bit)));
  }
  return out;
}

function refKey(ref: TargetRef | undefined): string {
  if (!ref) return '-';
  return ref.kind === 'hero' ? `h${ref.side}` : `m${ref.side}:${ref.instanceId}`;
}

// 动作的规范化键，用来判断一个动作是否在合法列表里。
export function actionKey(action: Action): string {
  switch (action.kind) {
    case 'mulligan':
      return `mulligan:${action.player}:${action.replace.join(',')}`;
    case 'play_card':
      return `play:${action.handIndex}:${action.position ?? '-'}:${refKey(action.target)}`;
    case 'attack':
      return `attack:${refKey(action.attacker)}:${refKey(action.target)}`;
    case 'hero_power':
      return `hero_power:${refKey(action.target)}`;
    case 'end_turn':
      return 'end_turn';
  }
}

// 动作字段的形状校验（docs/online.md 4.2 第 2 步、5.5 第 3 条）。动作可能来自网络，这里先把每个字段的类型和整数范围
// 查一遍，不对直接返回原因。不能靠后面的逻辑兜底：handIndex 传字符串 "0" 时 actionKey 拼出的键和合法动作一样，
// 但 applyAction 里按严格相等找手牌找不到，法术生效了牌还在手里（online.md 2.3 第三项）。
// 可选字段的值是 undefined 时当作没给；不认识的字段一律拒。合法返回 null。
export function checkActionShape(action: unknown): string | null {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) return 'malformed action: not an object';
  const a = action as Record<string, unknown>;
  if (typeof a.kind !== 'string' || !Object.hasOwn(ACTION_FIELDS, a.kind)) return 'malformed action: unknown kind';
  const allowed = ACTION_FIELDS[a.kind as Action['kind']];
  for (const key of Object.keys(a)) {
    if (!allowed.includes(key)) return `malformed action: unexpected field ${key}`;
  }
  const bad = (field: string) => `malformed action: bad ${field}`;
  switch (a.kind as Action['kind']) {
    case 'mulligan':
      if (a.player !== 0 && a.player !== 1) return bad('player');
      if (!Array.isArray(a.replace) || !a.replace.every(isIndex)) return bad('replace');
      return null;
    case 'play_card':
      if (!isIndex(a.handIndex)) return bad('handIndex');
      if (a.position !== undefined && !isIndex(a.position)) return bad('position');
      if (a.target !== undefined && !isTargetRef(a.target)) return bad('target');
      return null;
    case 'attack':
      if (!isTargetRef(a.attacker)) return bad('attacker');
      if (!isTargetRef(a.target)) return bad('target');
      return null;
    case 'hero_power':
      if (a.target !== undefined && !isTargetRef(a.target)) return bad('target');
      return null;
    case 'end_turn':
      return null;
  }
}

// 每种动作允许出现的字段
const ACTION_FIELDS: Record<Action['kind'], readonly string[]> = {
  mulligan: ['kind', 'player', 'replace'],
  play_card: ['kind', 'handIndex', 'position', 'target'],
  attack: ['kind', 'attacker', 'target'],
  hero_power: ['kind', 'target'],
  end_turn: ['kind'],
};

// 非负整数（手牌下标、站位、实例 id）。字符串、负数、小数、NaN、Infinity 都不算
function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isTargetRef(v: unknown): v is TargetRef {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const t = v as Record<string, unknown>;
  if (t.side !== 0 && t.side !== 1) return false;
  const keys = Object.keys(t);
  if (t.kind === 'hero') return keys.every((k) => k === 'side' || k === 'kind');
  if (t.kind === 'minion') return isIndex(t.instanceId) && keys.every((k) => k === 'side' || k === 'kind' || k === 'instanceId');
  return false;
}

// 检查动作是否合法，合法返回 null，否则返回错误说明。先查字段形状（checkActionShape），再对照合法动作列表。
export function checkAction(state: GameState, input: unknown): string | null {
  const shapeError = checkActionShape(input);
  if (shapeError) return shapeError;
  const action = input as Action;
  const key = actionKey(action);
  const side: Side = action.kind === 'mulligan' ? action.player : state.current;
  if (state.phase === 'over') return 'game is over';
  if (state.phase === 'mulligan' && action.kind !== 'mulligan') return 'only mulligan is allowed in mulligan phase';
  if (state.phase === 'playing' && action.kind === 'mulligan') return 'mulligan phase is over';
  if (action.kind === 'play_card') {
    const card = state.players[state.current].hand[action.handIndex];
    if (!card) return `no card at hand index ${action.handIndex}`;
    if (!findCard(card.cardId)) return `unknown card ${card.cardId}`;
  }
  const legal = listLegalActions(state, side);
  if (!legal.some((a) => actionKey(a) === key)) return `illegal action: ${key}`;
  return null;
}
