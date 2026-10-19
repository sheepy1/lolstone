// 局面与卡牌数据的类型。对应 spec 3.4、3.5、6.5。
// 局面是纯数据：没有 Set、Map、类实例，能直接 JSON 序列化。

export type Side = 0 | 1;
export type HeroClass = 'demacia' | 'noxus' | 'ionia' | 'freljord';
export type CardClass = 'neutral' | HeroClass;

export type Keyword =
  | 'taunt'
  | 'charge'
  | 'rush'
  | 'divine_shield'
  | 'stealth'
  | 'windfury'
  | 'lifesteal'
  | 'poisonous';

export const ALL_KEYWORDS: readonly Keyword[] = [
  'taunt',
  'charge',
  'rush',
  'divine_shield',
  'stealth',
  'windfury',
  'lifesteal',
  'poisonous',
];

export type Fx = 'physical' | 'fire' | 'frost' | 'holy' | 'shadow';

// ---------- 效果模型（spec 3.4） ----------

export type TargetPick =
  | 'any_character'
  | 'any_minion'
  | 'enemy_minion'
  | 'friendly_minion'
  | 'other_friendly_minion';

export type TargetSpec = {
  pick: TargetPick;
  where?: { damaged?: boolean };
};

export type ActionTarget =
  | 'chosen'
  | 'self'
  | 'friendly_hero'
  | 'enemy_hero'
  | 'all_enemy_minions'
  | 'all_minions'
  | 'other_friendly_minions'
  | 'random_enemy_minion'
  | 'random_other_friendly_minion';

export type EffectAction =
  | { kind: 'damage'; amount: number; target: ActionTarget; fx: Fx }
  | { kind: 'heal'; amount: number; target: ActionTarget; fx: Fx }
  | {
      kind: 'buff';
      target: ActionTarget;
      attack?: number;
      health?: number;
      keywords?: Keyword[];
      duration: 'permanent' | 'turn';
      fx: Fx;
    }
  | { kind: 'summon'; token: string; count: number; fx: Fx }
  | { kind: 'draw'; count: number }
  | { kind: 'freeze'; target: ActionTarget; fx: Fx }
  | { kind: 'silence'; target: ActionTarget; fx: Fx }
  | { kind: 'destroy'; target: ActionTarget; fx: Fx }
  | { kind: 'bounce'; target: ActionTarget; fx: Fx }
  | { kind: 'transform'; target: ActionTarget; into: string; fx: Fx }
  | { kind: 'gain_mana'; mode: 'empty' | 'temp'; amount: number }
  | { kind: 'extra_attack'; target: 'self' }
  | { kind: 'random_keyword'; target: 'self'; from: Keyword[] };

export type EffectActionKind = EffectAction['kind'];

export type TriggeredTiming =
  | 'cast'
  | 'battlecry'
  | 'deathrattle'
  | 'combo'
  | 'turn_start'
  | 'turn_end'
  | 'on_kill';

export type TriggeredEffect = {
  trigger: TriggeredTiming;
  target?: TargetSpec; // 只有 cast、battlecry、combo 可以声明
  actions: EffectAction[];
};

export type StaticEffect =
  | { trigger: 'static'; kind: 'spell_damage'; amount: number }
  | { trigger: 'static'; kind: 'enrage'; attack?: number; health?: number; keywords?: Keyword[] };

export type Effect = TriggeredEffect | StaticEffect;

export type CardDef = {
  id: string;
  name: string;
  type: 'minion' | 'spell' | 'hero_power';
  class: CardClass;
  cost: number;
  attack?: number;
  health?: number;
  keywords?: Keyword[];
  text: string;
  effects?: Effect[];
  script?: string;
  champion?: string;
  token?: boolean;
};

export type HeroClassDef = {
  id: HeroClass;
  name: string;
  champion: string;
  heroPower: string;
};

// ---------- 局面（spec 6.5） ----------

// 实现细节（spec 没写类型）：一张牌的实例。instanceId 在整局内唯一，
// 由 GameState.nextInstanceId 分配；牌从牌库到手牌保持同一个 id。
export type CardInstance = { instanceId: number; cardId: string };

// 实现细节：一条增减益。attack/health 记的是实际生效的变化量
// （攻击力最低压到 0，被压掉的部分不记），到期移除时按这个量反向扣回。
// source 是施加者的实例 id；激怒自己产生的增益 source 为 null、enrage 为 true。
export type Buff = {
  source: number | null;
  sourceCardId: string | null;
  attack: number;
  health: number;
  keywords: Keyword[];
  duration: 'permanent' | 'turn';
  enrage?: true;
};

// 实现细节：mulberry32 的 32 位状态。
export type RngState = { s: number };

export type MinionState = {
  instanceId: number;
  cardId: string;
  attack: number;
  health: number;
  maxHealth: number;
  buffs: Buff[];
  keywords: Keyword[];
  attacksThisTurn: number;
  enteredTurn: number;
  frozenAt?: number;
  silenced: boolean;
  summonOrder: number;
  usedOnce?: string[];
  // 以下是 spec 6.5 之外补的字段
  extraAttacks: number; // extra_attack 给的额外攻击次数，回合结束清零
  pendingDestroy?: boolean; // 被消灭或剧毒命中，等死亡结算移除
};

export type PlayerState = {
  heroClass: HeroClass;
  hero: { health: number; maxHealth: number };
  mana: { max: number; current: number; temp: number };
  deck: CardInstance[];
  hand: CardInstance[];
  board: MinionState[];
  fatigue: number;
  heroPowerUsed: boolean;
  cardsPlayedThisTurn: number;
  mulliganDone: boolean;
  // spec 6.5 之外补的字段：换牌阶段已提交、还没执行的换牌下标（双方都提交后才执行）
  mulliganReplace?: number[];
};

export type GameState = {
  phase: 'mulligan' | 'playing' | 'over';
  turn: number; // 换牌阶段为 0，对局从 1 开始，每次换人 +1
  current: Side;
  players: [PlayerState, PlayerState];
  rng: RngState;
  winner?: Side | 'draw';
  // spec 6.5 之外补的计数器
  nextInstanceId: number;
  nextSummonOrder: number;
};

export type TargetRef = { side: Side; kind: 'hero' } | { side: Side; kind: 'minion'; instanceId: number };

export const MAX_HAND = 10;
export const MAX_BOARD = 7;
export const MAX_MANA = 10;
export const HERO_HEALTH = 30;
export const HERO_POWER_COST = 2;
export const MANA_POTION_ID = 'token.mana_potion';
export const HIDDEN_CARD_ID = 'hidden';

export function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}
