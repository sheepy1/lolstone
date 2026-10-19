// L1 贪心 AI（spec 4.1、4.2）。
// 每次调用只决定下一个动作：先找斩杀，找不到就把每个合法动作模拟一步、按评估分（spec 4.3）挑最好的，
// 比现在高出阈值才做，否则结束回合。由驱动方反复调用，直到它返回结束回合。
// 所有模拟都在 maskHidden(局面, 自己) 上做：看不到对方手牌和双方牌库，随机数是 forkRng 派生的流，
// 不消耗真实对局的随机数。
import { listLegalActions, type Action } from '../engine/actions';
import { getCard, getHeroClass } from '../engine/cardDb';
import { applyAction } from '../engine/game';
import { canAttack, hasKeyword, maxAttacks, spellDamage } from '../engine/keywords';
import { maskHidden } from '../engine/mask';
import {
  HERO_POWER_COST,
  HIDDEN_CARD_ID,
  MANA_POTION_ID,
  other,
  type CardDef,
  type EffectAction,
  type GameState,
  type MinionState,
  type Side,
  type TargetRef,
} from '../engine/state';
import { evaluate, EVAL_WEIGHTS, type EvalWeights } from './eval';
import type { ChooseAction } from './types';

export type L1Options = {
  threshold: number; // 最好的动作比现在高出这么多分才做（spec 4.2：0.5）
  weights: EvalWeights;
  lethalNodeLimit: number; // 斩杀搜索最多模拟多少步，超过就当找不到
};

export const L1_DEFAULTS: L1Options = {
  threshold: 0.5,
  weights: EVAL_WEIGHTS,
  lethalNodeLimit: 2000,
};

const END_TURN: Action = { kind: 'end_turn' };

export function createL1(options: Partial<L1Options> = {}): ChooseAction {
  const opts: L1Options = { ...L1_DEFAULTS, ...options };
  return (state, side, rng) => {
    if (listLegalActions(state, side).length === 0) return null;
    const action = state.phase === 'mulligan' ? mulliganChoice(state, side) : choosePlaying(state, side, opts);
    return { action, rng };
  };
}

// 默认参数的 L1，接口和 l0ChooseAction 一样。
export const l1ChooseAction: ChooseAction = createL1();

// ---------- 换牌 ----------

// 换掉费用大于等于 4 的牌；后手（手里有法力药水）保留最靠左的一张 4 费。
export function mulliganChoice(state: GameState, side: Side): Action {
  const hand = state.players[side].hand;
  const second = hand.some((c) => c.cardId === MANA_POTION_ID);
  let keptFour = false;
  const replace: number[] = [];
  hand.forEach((c, i) => {
    if (c.cardId === MANA_POTION_ID || c.cardId === HIDDEN_CARD_ID) return;
    const cost = getCard(c.cardId).cost;
    if (cost < 4) return;
    if (cost === 4 && second && !keptFour) {
      keptFour = true;
      return;
    }
    replace.push(i);
  });
  return { kind: 'mulligan', player: side, replace };
}

// ---------- 回合内 ----------

function choosePlaying(real: GameState, side: Side, opts: L1Options): Action {
  const view = maskHidden(real, side);
  const lethal = findLethal(view, side, opts.lethalNodeLimit);
  if (lethal) return lethal;

  const base = evaluate(view, side, opts.weights);
  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const action of candidateActions(view, side)) {
    const score = scoreAction(view, side, action, opts.weights, true);
    if (score > bestScore) {
      best = action;
      bestScore = score;
    }
  }
  return best && bestScore - base > opts.threshold ? best : END_TURN;
}

// 合法动作去掉结束回合；随从只放最右边。M1 卡池里没有看站位的效果，放哪儿模拟结果都一样，
// 只留一个位置能把模拟次数降到几分之一。
export function candidateActions(state: GameState, side: Side): Action[] {
  const boardSize = state.players[side].board.length;
  return listLegalActions(state, side).filter(
    (a) => a.kind !== 'end_turn' && !(a.kind === 'play_card' && a.position !== undefined && a.position !== boardSize),
  );
}

// 模拟一步后的评估分。有些动作做完本身不加分，价值在于打开了下一步（见 opensFollowUp），
// 这类动作再往后看一步，取"做完它再做最好的一步"和"只做它"里高的那个。
function scoreAction(state: GameState, side: Side, action: Action, w: EvalWeights, lookAhead: boolean): number {
  const r = applyAction(state, action);
  if (!r.ok) return -Infinity;
  let score = evaluate(r.state, side, w);
  if (lookAhead && r.state.phase === 'playing' && opensFollowUp(state, r.state, action, side)) {
    for (const next of candidateActions(r.state, side)) {
      score = Math.max(score, scoreAction(r.state, side, next, w, false));
    }
  }
  return score;
}

// 单看一步会低估的动作：
// - 当前法力变多（法力药水）：本身不改变场面，单看一步永远不值得做。
// - 本回合第一张牌，而手里还有连击牌：先出它，连击牌才有连击效果。
// - 把自己的随从移回手牌（传送回城）：场面分少了，价值在重新打出、再触发一次战吼。
// - 攻击后攻击者多了一次攻击机会（易消灭随从后可以再次攻击）：第二次攻击的价值要算在这次攻击上。
function opensFollowUp(before: GameState, after: GameState, action: Action, side: Side): boolean {
  const b = before.players[side];
  const a = after.players[side];
  if (a.mana.current > b.mana.current) return true;
  if (action.kind === 'play_card') {
    if (a.hand.some((c) => b.board.some((m) => m.instanceId === c.instanceId))) return true;
    if (b.cardsPlayedThisTurn === 0 && a.hand.some((c) => c.cardId !== HIDDEN_CARD_ID && hasCombo(getCard(c.cardId)))) {
      return true;
    }
  }
  if (action.kind === 'attack' && action.attacker.kind === 'minion') {
    const id = action.attacker.instanceId;
    const was = b.board.find((m) => m.instanceId === id);
    const now = a.board.find((m) => m.instanceId === id);
    if (was && now && now.extraAttacks > was.extraAttacks) return true;
  }
  return false;
}

function hasCombo(def: CardDef): boolean {
  return (def.effects ?? []).some((e) => e.trigger === 'combo');
}

// ---------- 斩杀 ----------

// 先用伤害上限粗筛（可用攻击 + 直伤 + 英雄技能，嘲讽要先打掉），够了再在模拟里深搜一个能打死对方英雄的动作序列。
// 找到就返回序列的第一步；下一次调用重新搜，所以真实对局里随机结果和模拟不一样时也不会照着旧序列硬打。
export function findLethal(view: GameState, side: Side, nodeLimit: number): Action | null {
  if (!mayHaveLethal(view, side)) return null;
  const seen = new Set<string>();
  let nodes = 0;
  const search = (s: GameState): Action | null => {
    for (const action of lethalCandidates(s, side)) {
      if (nodes >= nodeLimit) return null;
      nodes += 1;
      const r = applyAction(s, action);
      if (!r.ok) continue;
      if (r.state.phase === 'over') {
        if (r.state.winner === side) return action;
        continue;
      }
      if (!mayHaveLethal(r.state, side)) continue;
      const key = JSON.stringify(r.state.players);
      if (seen.has(key)) continue;
      seen.add(key);
      if (search(r.state)) return action;
    }
    return null;
  };
  return search(view);
}

function mayHaveLethal(s: GameState, side: Side): boolean {
  return s.phase === 'playing' && s.current === side && damageUpperBound(s, side) >= s.players[other(side)].hero.health;
}

// 出牌和英雄技能里会触发的效果动作（含连击，宽松估计）。
function playActions(def: CardDef): EffectAction[] {
  return (def.effects ?? []).flatMap((e) =>
    e.trigger === 'cast' || e.trigger === 'battlecry' || e.trigger === 'combo' ? e.actions : [],
  );
}

function spellDamageOf(def: CardDef): number {
  return (def.effects ?? []).reduce((n, e) => n + (e.trigger === 'static' && e.kind === 'spell_damage' ? e.amount : 0), 0);
}

// 这一回合最多能对敌方英雄造成多少伤害。只用来剪枝，宁可估多：每张手牌只看自己付不付得起，不管总法力够不够。
// 嘲讽挡住的部分：要打到英雄得先把嘲讽的生命值打掉，这部分从总伤害里扣（圣盾嘲讽多扣一次最小攻击）。
export function damageUpperBound(s: GameState, side: Side): number {
  const me = s.players[side];
  const enemy = s.players[other(side)];
  const sick = (enteredTurn: number, charge: boolean) => enteredTurn >= s.turn && !charge;

  let attackDamage = 0; // 能打脸的随从攻击总量
  let swings = 0; // 能打脸的攻击次数
  let bestSwing = 0; // 单个随从剩余攻击次数的最大值，单体攻击增益按它算
  let minAttack = Infinity;
  let tauntOnly = 0; // 只能打随从的攻击（突袭入场当回合），可以用来打掉嘲讽
  for (const m of me.board) {
    if (!canAttack(s, m)) continue;
    const left = maxAttacks(m) - m.attacksThisTurn;
    if (sick(m.enteredTurn, hasKeyword(m, 'charge'))) {
      tauntOnly += m.attack * left;
      continue;
    }
    attackDamage += m.attack * left;
    swings += left;
    bestSwing = Math.max(bestSwing, left);
    minAttack = Math.min(minAttack, m.attack);
    // 消灭随从后能再次攻击（易）：打死嘲讽不占用打脸的攻击次数，算作只能打随从的攻击
    if (hasOnKillAttack(m)) tauntOnly += m.attack * killableTaunts(s, side, m.attack);
  }

  const cards: CardDef[] = me.hand.filter((c) => c.cardId !== HIDDEN_CARD_ID).map((c) => getCard(c.cardId));
  const tempMana = cards.reduce(
    (n, d) => n + playActions(d).reduce((k, a) => k + (a.kind === 'gain_mana' && a.mode === 'temp' ? a.amount : 0), 0),
    0,
  );
  const mana = me.mana.current + tempMana;
  const usable = cards.filter((d) => d.cost <= mana);
  if (!me.heroPowerUsed && mana >= HERO_POWER_COST) usable.push(getCard(getHeroClass(me.heroClass).heroPower));

  // 冲锋随从先算进攻击次数，群体攻击增益要用
  for (const d of usable) {
    if (d.type !== 'minion') continue;
    if (d.keywords?.includes('rush') && !d.keywords.includes('charge')) tauntOnly += d.attack ?? 0;
    if (!d.keywords?.includes('charge')) continue;
    const left = d.keywords.includes('windfury') ? 2 : 1;
    attackDamage += (d.attack ?? 0) * left;
    swings += left;
    bestSwing = Math.max(bestSwing, left);
  }
  const bonusSpellDamage = spellDamage(s, side) + usable.reduce((n, d) => n + spellDamageOf(d), 0);
  let direct = 0;
  let buff = 0;
  for (const d of usable) {
    const spellBonus = d.type === 'spell' ? bonusSpellDamage : 0;
    const eff = (d.effects ?? []).find((e) => e.trigger !== 'static' && e.target);
    const chosenCanHitHero = eff !== undefined && eff.trigger !== 'static' && eff.target?.pick === 'any_character';
    for (const a of playActions(d)) {
      if (a.kind === 'damage' && (a.target === 'enemy_hero' || (a.target === 'chosen' && chosenCanHitHero))) {
        direct += a.amount + spellBonus;
      } else if (a.kind === 'buff' && (a.attack ?? 0) > 0) {
        const perSwing = a.attack!;
        buff += a.target === 'chosen' || a.target === 'self' ? perSwing * bestSwing : perSwing * swings;
        if (a.keywords?.includes('windfury')) buff += attackDamage;
      } else if (a.kind === 'buff' && a.keywords?.includes('windfury')) {
        buff += attackDamage;
      } else if (a.kind === 'extra_attack' || a.kind === 'random_keyword') {
        buff += attackDamage;
      }
    }
  }

  let blocked = 0;
  for (const m of enemy.board) {
    if (!hasKeyword(m, 'taunt') || hasKeyword(m, 'stealth')) continue;
    blocked += m.health;
    if (hasKeyword(m, 'divine_shield') && Number.isFinite(minAttack)) blocked += minAttack;
  }
  // 法术和英雄技能能直接解掉嘲讽（消灭、沉默、变形、伤害），这时不扣嘲讽
  const canRemoveTaunt = usable.some((d) =>
    playActions(d).some((a) => a.kind === 'destroy' || a.kind === 'silence' || a.kind === 'transform' || a.kind === 'damage' || a.kind === 'bounce'),
  );
  const toFace = attackDamage + buff - (canRemoveTaunt ? 0 : Math.max(0, blocked - tauntOnly));
  return Math.max(0, toFace) + direct;
}

function hasOnKillAttack(m: MinionState): boolean {
  return !m.silenced && (getCard(m.cardId).effects ?? []).some((e) => e.trigger === 'on_kill' && e.actions.some((a) => a.kind === 'extra_attack'));
}

// 敌方场上能被这么多攻击力一下打死的嘲讽随从数（圣盾的不算）。
function killableTaunts(s: GameState, side: Side, attack: number): number {
  return s.players[other(side)].board.filter(
    (m) => hasKeyword(m, 'taunt') && !hasKeyword(m, 'stealth') && !hasKeyword(m, 'divine_shield') && m.health <= attack,
  ).length;
}

// 斩杀搜索里只试可能有用的动作：打脸、打嘲讽、能加伤害或解嘲讽的牌。按"先打脸、再直伤、再其他"排序，
// 多数情况第一条路径就能找到。
function lethalCandidates(s: GameState, side: Side): Action[] {
  const enemySide = other(side);
  const isTaunt = (t: TargetRef) =>
    t.kind === 'minion' && s.players[enemySide].board.some((m) => m.instanceId === t.instanceId && hasKeyword(m, 'taunt'));
  const face: Action[] = [];
  const burn: Action[] = [];
  const rest: Action[] = [];
  for (const a of candidateActions(s, side)) {
    if (a.kind === 'attack') {
      if (a.target.kind === 'hero') face.push(a);
      else if (isTaunt(a.target)) rest.push(a);
      continue;
    }
    if (a.kind !== 'play_card' && a.kind !== 'hero_power') continue;
    const def =
      a.kind === 'hero_power'
        ? getCard(getHeroClass(s.players[side].heroClass).heroPower)
        : getCard(s.players[side].hand[a.handIndex].cardId);
    if (!helpsLethal(def)) continue;
    const t = a.target;
    if (!t) {
      (playActions(def).some((e) => e.kind === 'damage' && e.target === 'enemy_hero') ? burn : rest).push(a);
    } else if (t.side === enemySide && t.kind === 'hero') {
      burn.push(a);
    } else if (t.side === enemySide ? isTaunt(t) : t.kind === 'minion' && buffsFriend(def)) {
      rest.push(a);
    }
  }
  return [...face, ...burn, ...rest];
}

function helpsLethal(def: CardDef): boolean {
  if (def.type === 'minion' && (def.keywords?.includes('charge') || def.keywords?.includes('rush'))) return true;
  if (spellDamageOf(def) > 0) return true;
  return playActions(def).some(
    (a) =>
      a.kind === 'damage' ||
      a.kind === 'destroy' ||
      a.kind === 'silence' ||
      a.kind === 'transform' ||
      a.kind === 'bounce' ||
      a.kind === 'extra_attack' ||
      (a.kind === 'gain_mana' && a.mode === 'temp') ||
      (a.kind === 'buff' && ((a.attack ?? 0) > 0 || (a.keywords ?? []).some((k) => k === 'windfury' || k === 'charge'))),
  );
}

function buffsFriend(def: CardDef): boolean {
  return playActions(def).some((a) => a.kind === 'buff' || a.kind === 'extra_attack');
}
