// 引擎事件（spec 6.4）。表现层只靠这些事件演出，每个事件带演出需要的全部信息。
import type { CardInstance, Fx, Keyword, Side, TargetRef } from './state';

// 事件的来源。
export type SourceRef =
  | { kind: 'minion'; side: Side; instanceId: number; cardId: string }
  | { kind: 'hero'; side: Side }
  | { kind: 'spell'; side: Side; instanceId: number; cardId: string }
  | { kind: 'hero_power'; side: Side; cardId: string }
  | { kind: 'fatigue'; side: Side };

export type ManaSnapshot = { max: number; current: number; temp: number };

export type TriggerTiming = 'battlecry' | 'deathrattle' | 'combo' | 'turn_start' | 'turn_end' | 'on_kill' | 'script';

type E<K extends string, T> = { kind: K; group: number } & T;

export type GameEvent =
  | E<'mulligan_start', { first: Side; hands: [CardInstance[], CardInstance[]] }>
  | E<'mulligan_done', { side: Side; replaced: CardInstance[]; drawn: CardInstance[] }>
  | E<'game_start', { first: Side }>
  | E<'turn_start', { side: Side; turn: number }>
  | E<'turn_end', { side: Side; turn: number }>
  | E<'draw', { side: Side; card: CardInstance; handIndex: number }>
  | E<'burn', { side: Side; card: CardInstance }>
  | E<'fatigue', { side: Side; amount: number }>
  | E<
      'card_played',
      {
        side: Side;
        card: CardInstance;
        cardType: 'minion' | 'spell';
        handIndex: number;
        cost: number;
        position: number | null; // 随从的入场位置，法术为 null
        target: TargetRef | null;
      }
    >
  | E<
      'minion_summoned',
      {
        side: Side;
        target: TargetRef;
        cardId: string;
        position: number;
        via: 'play' | 'effect' | 'hero_power';
        attack: number;
        health: number;
        source: SourceRef | null; // via 为 play 时为 null
        fx: Fx | null;
        fxId?: string; // 动作写了 fxId 才有，没写时这个键不出现
      }
    >
  | E<'spell_cast', { side: Side; card: CardInstance; target: TargetRef | null }>
  | E<'hero_power_used', { side: Side; cardId: string; target: TargetRef | null }>
  | E<
      'trigger',
      {
        source: SourceRef;
        timing: TriggerTiming;
        target: TargetRef | null; // chosen 目标
        script: string | null; // timing 为 script 时是脚本名
      }
    >
  | E<'attack', { attacker: TargetRef; target: TargetRef }>
  | E<
      'damage',
      {
        source: SourceRef;
        target: TargetRef;
        amount: number; // 实际扣掉的生命值，被圣盾挡下时为 0
        shieldAbsorbed: number; // 被圣盾挡下的伤害
        healthBefore: number;
        healthAfter: number;
        lethalPrevented: boolean; // 泰达米尔这类替代致命伤害的效果拦下了这次死亡
        fx: Fx;
        fxId?: string;
      }
    >
  | E<
      'heal',
      {
        source: SourceRef;
        target: TargetRef;
        amount: number; // 实际恢复量
        healthBefore: number;
        healthAfter: number;
        fx: Fx;
        fxId?: string;
      }
    >
  | E<
      'death',
      {
        target: TargetRef;
        cardId: string;
        position: number;
        // 只有被带 fxId 的消灭动作消灭时才有这两个字段（消灭本身不发事件，招牌卡的特效挂在 death 上）
        fx?: Fx;
        fxId?: string;
      }
    >
  | E<
      'buff',
      {
        source: SourceRef | null;
        target: TargetRef;
        reason: 'effect' | 'enrage' | 'expire';
        attack: number; // 实际变化量，可以为负
        health: number;
        keywords: Keyword[]; // 获得的关键词
        keywordsLost: Keyword[]; // 失去的关键词（到期、激怒消失）
        duration: 'permanent' | 'turn';
        attackBefore: number;
        attackAfter: number;
        healthBefore: number;
        healthAfter: number;
        maxHealthBefore: number;
        maxHealthAfter: number;
        fx: Fx;
        fxId?: string;
      }
    >
  | E<
      'silence',
      {
        source: SourceRef;
        target: TargetRef;
        attackBefore: number;
        attackAfter: number;
        healthBefore: number;
        healthAfter: number;
        maxHealthBefore: number;
        maxHealthAfter: number;
        keywordsLost: Keyword[];
        fx: Fx;
        fxId?: string;
      }
    >
  | E<'freeze', { source: SourceRef; target: TargetRef; frozenAt: number; fx: Fx; fxId?: string }>
  | E<'unfreeze', { target: TargetRef; reason: 'turn_end' | 'silence' }>
  | E<'shield_broken', { target: TargetRef }>
  | E<'stealth_lost', { target: TargetRef }>
  | E<
      'bounce',
      {
        source: SourceRef;
        target: TargetRef;
        cardId: string;
        position: number; // 离场前在场上的位置
        handIndex: number | null; // 回到手牌第几张；手牌满被销毁时为 null
        destroyed: boolean;
        card: CardInstance | null; // 回到手牌的那张牌
        fx: Fx;
        fxId?: string;
      }
    >
  | E<
      'transform',
      {
        source: SourceRef;
        target: TargetRef; // 原随从
        cardId: string; // 原随从的卡牌 id
        into: string; // 变成的卡牌 id
        newTarget: TargetRef; // 新随从
        position: number;
        attack: number;
        health: number;
        fx: Fx;
        fxId?: string;
      }
    >
  | E<
      'mana_changed',
      {
        side: Side;
        before: ManaSnapshot;
        after: ManaSnapshot;
        reason: 'turn_start' | 'play_card' | 'hero_power' | 'gain_mana' | 'turn_end';
      }
    >
  | E<'game_over', { winner: Side | 'draw' }>;

export type GameEventKind = GameEvent['kind'];

export type EventOf<K extends GameEventKind> = Extract<GameEvent, { kind: K }>;

export const ENGINE_EVENT_KINDS: readonly GameEventKind[] = [
  'mulligan_start',
  'mulligan_done',
  'game_start',
  'turn_start',
  'turn_end',
  'draw',
  'burn',
  'fatigue',
  'card_played',
  'minion_summoned',
  'spell_cast',
  'hero_power_used',
  'trigger',
  'attack',
  'damage',
  'heal',
  'death',
  'buff',
  'silence',
  'freeze',
  'unfreeze',
  'shield_broken',
  'stealth_lost',
  'bounce',
  'transform',
  'mana_changed',
  'game_over',
];
