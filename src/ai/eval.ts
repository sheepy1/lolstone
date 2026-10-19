// 局面评估函数（spec 4.3）。L1 贪心用它比较"执行一个动作之后"和"现在"哪个好。
// 只读局面，不改；在遮挡后的局面上算，不需要看对方手牌内容，只用张数。
import { hasKeyword, isFrozen, staticEffects } from '../engine/keywords';
import { MAX_MANA, other, type GameState, type HeroClass, type MinionState, type Side } from '../engine/state';

export type EvalWeights = {
  wHp: Record<HeroClass, number>; // 英雄生命差的权重，按评估方的职业取
  wHand: number; // 手牌张数差的权重
  wMana: number; // 法力上限差的权重，上限按 10 封顶
  win: number; // 对方死亡加分、我方死亡扣分
  minion: {
    attack: number;
    health: number;
    base: number;
    taunt: number;
    divineShieldPerAttack: number;
    windfuryPerAttack: number;
    stealth: number;
    lifesteal: number;
    poisonous: number;
    spellDamagePerPoint: number;
  };
};

// 起始权重，按 AI 互打的胜率再调（spec 4.3）。
export const EVAL_WEIGHTS: EvalWeights = {
  wHp: { noxus: 1.5, freljord: 0.6, demacia: 1.0, ionia: 1.0 },
  wHand: 0.7,
  wMana: 2,
  win: 1000,
  minion: {
    attack: 1.0,
    health: 0.8,
    base: 0.5,
    taunt: 1,
    divineShieldPerAttack: 0.5,
    windfuryPerAttack: 0.8,
    stealth: 0.5,
    lifesteal: 0.5,
    poisonous: 2,
    spellDamagePerPoint: 1,
  },
};

// 一个随从的价值。被冻结的随从这一轮打不了人，攻击力按 0 算（含圣盾、风怒里按攻击力算的部分）。
export function minionValue(m: MinionState, w: EvalWeights = EVAL_WEIGHTS): number {
  const mw = w.minion;
  const attack = isFrozen(m) ? 0 : m.attack;
  let v = attack * mw.attack + m.health * mw.health + mw.base;
  if (hasKeyword(m, 'taunt')) v += mw.taunt;
  if (hasKeyword(m, 'divine_shield')) v += attack * mw.divineShieldPerAttack;
  if (hasKeyword(m, 'windfury')) v += attack * mw.windfuryPerAttack;
  if (hasKeyword(m, 'stealth')) v += mw.stealth;
  if (hasKeyword(m, 'lifesteal')) v += mw.lifesteal;
  if (hasKeyword(m, 'poisonous')) v += mw.poisonous;
  for (const e of staticEffects(m)) {
    if (e.kind === 'spell_damage') v += e.amount * mw.spellDamagePerPoint;
  }
  return v;
}

// 站在 side 一方看的局面分，越高越好。
export function evaluate(state: GameState, side: Side, w: EvalWeights = EVAL_WEIGHTS): number {
  const me = state.players[side];
  const opp = state.players[other(side)];
  let score = w.wHp[me.heroClass] * (me.hero.health - opp.hero.health);
  for (const m of me.board) score += minionValue(m, w);
  for (const m of opp.board) score -= minionValue(m, w);
  score += w.wHand * (me.hand.length - opp.hand.length);
  // 凛冬将至这类加空水晶的牌只改上限，不算这一项就永远不会打
  score += w.wMana * (Math.min(me.mana.max, MAX_MANA) - Math.min(opp.mana.max, MAX_MANA));
  // 平局时两项抵消，按生命差等其余项算
  if (opp.hero.health <= 0) score += w.win;
  if (me.hero.health <= 0) score -= w.win;
  return score;
}
