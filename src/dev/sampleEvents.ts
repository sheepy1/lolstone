// 动画调试台用的样例事件：按当前显示局面造一个（或一组同 group 的）事件，单独触发一种动画。
// 事件只喂给调试台自己的导演，不经过引擎；字段按 events.ts 的定义填，数值取当前局面里说得通的值。
import { getHeroClass, type Fx, type GameEvent, type Side, type SourceRef, type TargetRef } from '../engine';
import type { PresentationEvent, PresentationEventKind } from '../presentation/events';
import type { ViewMinion, ViewState } from '../presentation/viewState';

let nextId = 50_000;

// 调试台上可选的样例变体：胜负结果
export const SAMPLE = {
  winner: '我方胜' as '我方胜' | '我方负' | '平局',
  tokens: 1, // minion_summoned（衍生物）一次召唤几个
  bounceFull: false, // bounce：手牌满，回手的牌被烧掉
  transformInto: '松鼠' as '松鼠' | '艾尼维亚',
  trigger: '战吼选目标' as '战吼选目标' | '回合结束' | '亡语',
};
const freshId = () => nextId++;

const hero = (side: Side): TargetRef => ({ side, kind: 'hero' });
const minionRef = (side: Side, m: ViewMinion): TargetRef => ({ side, kind: 'minion', instanceId: m.instanceId });
const minionSrc = (side: Side, m: ViewMinion): SourceRef => ({ kind: 'minion', side, instanceId: m.instanceId, cardId: m.cardId });

// 返回 null 表示当前局面造不出这种事件（比如场上没有随从），调试台提示先重置棋盘
export function sampleEvents(kind: PresentationEventKind, v: ViewState, fx: Fx = 'fire'): PresentationEvent[] | null {
  const me: Side = v.viewer;
  const opp: Side = me === 0 ? 1 : 0;
  const mine = v.players[me].board[0];
  const theirs = v.players[opp].board[0];
  const anyMinion = theirs ? { side: opp, m: theirs } : mine ? { side: me, m: mine } : null;
  const target = anyMinion ? minionRef(anyMinion.side, anyMinion.m) : hero(opp);
  const healthOf = (t: TargetRef) => (t.kind === 'hero' ? v.players[t.side].hero.health : (v.players[t.side].board.find((m) => m.instanceId === t.instanceId)?.health ?? 1));
  const g = 0;
  const spell = 'freljord.blizzard';
  const minionCard = 'neutral.ancient_krug';

  const one = (e: GameEvent): PresentationEvent[] => [e];
  switch (kind) {
    case 'mulligan_start':
      return one({ kind, group: g, first: me, hands: [v.players[0].hand, v.players[1].hand] });
    case 'mulligan_done': {
      // 换掉我方手里前两张，从牌库补两张新的
      const replaced = v.players[me].hand.slice(0, 2);
      const drawn = replaced.map(() => ({ instanceId: freshId(), cardId: minionCard }));
      return one({ kind, group: g, side: me, replaced, drawn });
    }
    case 'game_start':
      return one({ kind, group: g, first: me });
    case 'turn_start':
      return one({ kind, group: g, side: me, turn: v.turn + 1 });
    case 'turn_end':
      return one({ kind, group: g, side: me, turn: v.turn });
    case 'draw':
      return one({ kind, group: g, side: me, card: { instanceId: freshId(), cardId: minionCard }, handIndex: v.players[me].hand.length });
    case 'burn':
      return one({ kind, group: g, side: me, card: { instanceId: freshId(), cardId: minionCard } });
    case 'fatigue':
      return [
        { kind, group: g, side: me, amount: v.players[me].fatigue + 1 },
        { kind: 'damage', group: g + 1, source: { kind: 'fatigue', side: me }, target: hero(me), amount: 1, shieldAbsorbed: 0, healthBefore: v.players[me].hero.health, healthAfter: v.players[me].hero.health - 1, lethalPrevented: false, fx: 'shadow' },
      ];
    case 'card_played': {
      // 对手打出一张法术：放大停在中央
      const card = { instanceId: freshId(), cardId: spell };
      return one({ kind, group: g, side: opp, card, cardType: 'spell', handIndex: 0, cost: 6, position: null, target: null });
    }
    case 'minion_summoned': {
      // 衍生物：一次召唤 SAMPLE.tokens 个（同组，错开 80ms）
      const n = v.players[me].board.length;
      return Array.from({ length: Math.max(1, Math.min(7 - n, SAMPLE.tokens)) }, (_, i) => {
        const id = freshId();
        return { kind, group: g, side: me, target: { side: me, kind: 'minion', instanceId: id }, cardId: 'token.squirrel', position: n + i, via: 'effect', attack: 1, health: 1, source: { kind: 'hero', side: me }, fx: 'holy' } as PresentationEvent;
      });
    }
    case 'spell_cast':
      return one({ kind, group: g, side: me, card: { instanceId: freshId(), cardId: 'freljord.crystal_arrow' }, target });
    case 'hero_power_used':
      return one({ kind, group: g, side: me, cardId: getHeroClass(v.players[me].heroClass).heroPower, target: null });
    case 'trigger': {
      if (!mine) return null;
      if (SAMPLE.trigger === '回合结束') return one({ kind, group: g, source: minionSrc(me, mine), timing: 'turn_end', target: null, script: null });
      if (SAMPLE.trigger === '亡语') return one({ kind, group: g, source: minionSrc(me, mine), timing: 'deathrattle', target: null, script: null });
      // 战吼选目标，后面接动作本身（2 点伤害），看光线命中和伤害的衔接
      const before = healthOf(target);
      return [
        { kind, group: g, source: minionSrc(me, mine), timing: 'battlecry', target, script: null },
        { kind: 'damage', group: g + 1, source: minionSrc(me, mine), target, amount: 2, shieldAbsorbed: 0, healthBefore: before, healthAfter: Math.max(1, before - 2), lethalPrevented: false, fx: 'physical' },
      ];
    }
    case 'attack': {
      if (!mine) return null;
      const t = theirs ? minionRef(opp, theirs) : hero(opp);
      const before = healthOf(t);
      return [
        { kind: 'attack', group: g, attacker: minionRef(me, mine), target: t },
        { kind: 'damage', group: g, source: minionSrc(me, mine), target: t, amount: mine.attack, shieldAbsorbed: 0, healthBefore: before, healthAfter: Math.max(1, before - mine.attack), lethalPrevented: false, fx: 'physical' },
      ];
    }
    case 'damage': {
      const before = healthOf(target);
      return one({ kind, group: g, source: { kind: 'hero', side: me }, target, amount: 2, shieldAbsorbed: 0, healthBefore: before, healthAfter: Math.max(1, before - 2), lethalPrevented: false, fx });
    }
    case 'heal': {
      const before = healthOf(hero(me));
      return one({ kind, group: g, source: { kind: 'hero', side: me }, target: hero(me), amount: 3, healthBefore: before, healthAfter: Math.min(30, before + 3), fx: 'holy' });
    }
    case 'death':
      return theirs ? one({ kind, group: g, target: minionRef(opp, theirs), cardId: theirs.cardId, position: 0 }) : null;
    case 'buff': {
      if (!anyMinion) return null;
      const m = anyMinion.m;
      return one({ kind, group: g, source: { kind: 'hero', side: me }, target: minionRef(anyMinion.side, m), reason: 'effect', attack: 2, health: 2, keywords: ['taunt'], keywordsLost: [], duration: 'permanent', attackBefore: m.attack, attackAfter: m.attack + 2, healthBefore: m.health, healthAfter: m.health + 2, maxHealthBefore: m.maxHealth, maxHealthAfter: m.maxHealth + 2, fx: 'holy' });
    }
    case 'silence': {
      if (!anyMinion) return null;
      const m = anyMinion.m;
      return one({ kind, group: g, source: { kind: 'hero', side: me }, target: minionRef(anyMinion.side, m), attackBefore: m.attack, attackAfter: m.attack, healthBefore: m.health, healthAfter: m.health, maxHealthBefore: m.maxHealth, maxHealthAfter: m.maxHealth, keywordsLost: [...m.keywords], fx: 'holy' });
    }
    case 'freeze':
      return anyMinion ? one({ kind, group: g, source: { kind: 'hero', side: me }, target: minionRef(anyMinion.side, anyMinion.m), frozenAt: v.turn, fx: 'frost' }) : null;
    case 'unfreeze':
      return anyMinion ? one({ kind, group: g, target: minionRef(anyMinion.side, anyMinion.m), reason: 'turn_end' }) : null;
    case 'shield_broken':
      return anyMinion ? one({ kind, group: g, target: minionRef(anyMinion.side, anyMinion.m) }) : null;
    case 'stealth_lost':
      return anyMinion ? one({ kind, group: g, target: minionRef(anyMinion.side, anyMinion.m) }) : null;
    case 'bounce': {
      if (!mine) return null;
      const full = SAMPLE.bounceFull;
      return one({ kind, group: g, source: { kind: 'hero', side: me }, target: minionRef(me, mine), cardId: mine.cardId, position: 0, handIndex: full ? null : v.players[me].hand.length, destroyed: full, card: full ? null : { instanceId: mine.instanceId, cardId: mine.cardId }, fx: 'physical' });
    }
    case 'transform': {
      if (!anyMinion) return null;
      return one({ kind, group: g, source: { kind: 'hero', side: me }, target: minionRef(anyMinion.side, anyMinion.m), cardId: anyMinion.m.cardId, into: SAMPLE.transformInto === '松鼠' ? 'token.squirrel' : 'freljord.anivia', newTarget: { side: anyMinion.side, kind: 'minion', instanceId: freshId() }, position: 0, attack: SAMPLE.transformInto === '松鼠' ? 1 : 4, health: SAMPLE.transformInto === '松鼠' ? 1 : 4, fx: 'shadow' });
    }
    case 'mana_changed': {
      const m = v.players[me].mana;
      return one({ kind, group: g, side: me, before: m, after: { max: Math.min(10, m.max + 1), current: Math.min(10, m.max + 1), temp: 0 }, reason: 'turn_start' });
    }
    case 'game_over':
      return one({ kind, group: g, winner: SAMPLE.winner === '平局' ? 'draw' : SAMPLE.winner === '我方胜' ? me : opp });
    case 'ai_thinking':
      return [{ kind, group: g, side: opp, seconds: 0.8 }];
  }
}
