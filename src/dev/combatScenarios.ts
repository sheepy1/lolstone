// 动画调试台的战斗场景（m4-storyboard E11 到 E19、E24）：按当前显示局面造一组事件，每个场景对应分镜里的一种情况
// （单体、群体、打死、圣盾吸收、英雄轻伤和重伤……）。事件按引擎的分组习惯填 group：同一动作的事件同组，死亡另起一组。
// 字段按 events.ts 填，只喂给调试台自己的导演，不经过引擎。
import { getCard, type Fx, type Keyword, type Side, type SourceRef, type TargetRef } from '../engine';
import type { PresentationEvent } from '../presentation/events';
import type { ViewMinion, ViewState } from '../presentation/viewState';

export const COMBAT_SCENARIOS = [
  '攻击：随从互撞',
  '攻击：打死随从（含死亡合拢）',
  '攻击：敌方英雄',
  '攻击：打在圣盾上（先获得圣盾）',
  '风怒：连续两次攻击',
  '受伤：法术打随从',
  '受伤：群体法术（敌方全体）',
  '受伤：群体法术打死全部（含同时死亡）',
  '英雄受伤：我方',
  '英雄受伤：敌方',
  '治疗：随从',
  '治疗：我方英雄',
  '死亡：单个',
  '死亡：同时三个',
  '冻结：单个',
  '冻结：群体',
  '解冻',
  '圣盾：获得',
  '圣盾：打破',
  '潜行：进入',
  '潜行：进入再失去（攻击后）',
  '增益：单个',
  '增益：群体',
  '减益',
  '沉默（带嘲讽、圣盾）',
] as const;
export type CombatScenario = (typeof COMBAT_SCENARIOS)[number];

let nextId = 70_000;

const hero = (side: Side): TargetRef => ({ side, kind: 'hero' });
const ref = (side: Side, m: ViewMinion): TargetRef => ({ side, kind: 'minion', instanceId: m.instanceId });
const src = (side: Side, m: ViewMinion): SourceRef => ({ kind: 'minion', side, instanceId: m.instanceId, cardId: m.cardId });
const heroSrc = (side: Side): SourceRef => ({ kind: 'hero', side });

type Dmg = Extract<PresentationEvent, { kind: 'damage' }>;
type Buff = Extract<PresentationEvent, { kind: 'buff' }>;

function damageEv(group: number, source: SourceRef, target: TargetRef, before: number, amount: number, fx: Fx, lethal = false): Dmg {
  const after = lethal ? before - amount : Math.max(1, before - amount);
  return { kind: 'damage', group, source, target, amount: before - after, shieldAbsorbed: 0, healthBefore: before, healthAfter: after, lethalPrevented: false, fx };
}

function buffEv(group: number, side: Side, m: ViewMinion, attack: number, health: number, keywords: Keyword[] = []): Buff {
  return {
    kind: 'buff', group, source: heroSrc(side), target: ref(side, m), reason: 'effect', attack, health, keywords, keywordsLost: [], duration: 'permanent',
    attackBefore: m.attack, attackAfter: m.attack + attack, healthBefore: m.health, healthAfter: m.health + health,
    maxHealthBefore: m.maxHealth, maxHealthAfter: m.maxHealth + health, fx: 'holy',
  };
}

function deathEv(group: number, side: Side, m: ViewMinion, position: number): PresentationEvent {
  return { kind: 'death', group, target: ref(side, m), cardId: m.cardId, position };
}

// amount：伤害、治疗、增益的数值（调试台的滑块）
export function combatEvents(s: CombatScenario, v: ViewState, amount: number): PresentationEvent[] | null {
  const me: Side = v.viewer;
  const opp: Side = me === 0 ? 1 : 0;
  const mine = v.players[me].board;
  const theirs = v.players[opp].board;
  const a = mine[0];
  const t = theirs[Math.min(1, theirs.length - 1)] ?? theirs[0];
  const tIndex = t ? theirs.indexOf(t) : -1;
  switch (s) {
    case '攻击：随从互撞':
      if (!a || !t) return null;
      return [
        { kind: 'attack', group: 1, attacker: ref(me, a), target: ref(opp, t) },
        damageEv(1, src(me, a), ref(opp, t), t.health, Math.min(a.attack, t.health - 1) || 1, 'physical'),
        damageEv(1, src(opp, t), ref(me, a), a.health, Math.min(t.attack, a.health - 1) || 1, 'physical'),
      ];
    case '攻击：打死随从（含死亡合拢）':
      if (!a || !t) return null;
      return [
        { kind: 'attack', group: 1, attacker: ref(me, a), target: ref(opp, t) },
        damageEv(1, src(me, a), ref(opp, t), t.health, Math.max(a.attack, t.health), 'physical', true),
        damageEv(1, src(opp, t), ref(me, a), a.health, Math.min(t.attack, a.health - 1) || 1, 'physical'),
        deathEv(2, opp, t, tIndex),
      ];
    case '攻击：敌方英雄':
      if (!a) return null;
      return [
        { kind: 'attack', group: 1, attacker: ref(me, a), target: hero(opp) },
        damageEv(1, src(me, a), hero(opp), v.players[opp].hero.health, amount, 'physical'),
      ];
    case '攻击：打在圣盾上（先获得圣盾）':
      if (!a || !t) return null;
      return [
        buffEv(1, opp, t, 0, 0, ['divine_shield']),
        { kind: 'attack', group: 2, attacker: ref(me, a), target: ref(opp, t) },
        { kind: 'damage', group: 2, source: src(me, a), target: ref(opp, t), amount: 0, shieldAbsorbed: a.attack, healthBefore: t.health, healthAfter: t.health, lethalPrevented: false, fx: 'physical' },
        { kind: 'shield_broken', group: 2, target: ref(opp, t) },
        damageEv(2, src(opp, t), ref(me, a), a.health, Math.min(t.attack, a.health - 1) || 1, 'physical'),
      ];
    case '风怒：连续两次攻击':
      if (!a || !t) return null;
      return [1, 2].flatMap((g) => [
        { kind: 'attack', group: g, attacker: ref(me, a), target: hero(opp) } as PresentationEvent,
        damageEv(g, src(me, a), hero(opp), v.players[opp].hero.health - (g - 1) * a.attack, a.attack, 'physical'),
      ]);
    case '受伤：法术打随从':
      return t ? [damageEv(1, heroSrc(me), ref(opp, t), t.health, amount, 'fire')] : null;
    case '受伤：群体法术（敌方全体）':
      return theirs.length ? theirs.map((m) => damageEv(1, heroSrc(me), ref(opp, m), m.health, amount, 'fire')) : null;
    case '受伤：群体法术打死全部（含同时死亡）':
      return theirs.length
        ? [...theirs.map((m) => damageEv(1, heroSrc(me), ref(opp, m), m.health, Math.max(amount, m.health), 'fire', true)), ...theirs.map((m, i) => deathEv(2, opp, m, i))]
        : null;
    case '英雄受伤：我方':
      return [damageEv(1, heroSrc(opp), hero(me), v.players[me].hero.health, amount, 'fire')];
    case '英雄受伤：敌方':
      return [damageEv(1, heroSrc(me), hero(opp), v.players[opp].hero.health, amount, 'fire')];
    case '治疗：随从': {
      // 生命最多的那个先受伤，再治回来（两组）
      const m = [...mine].sort((p, q) => q.health - p.health)[0];
      if (!m) return null;
      const hurt = Math.min(amount, m.health - 1);
      if (hurt <= 0) return null;
      return [
        damageEv(1, heroSrc(opp), ref(me, m), m.health, hurt, 'fire'),
        { kind: 'heal', group: 2, source: heroSrc(me), target: ref(me, m), amount: hurt, healthBefore: m.health - hurt, healthAfter: m.health, fx: 'holy' },
      ];
    }
    case '治疗：我方英雄': {
      const h = v.players[me].hero;
      const after = Math.min(h.maxHealth, h.health + amount);
      return [{ kind: 'heal', group: 1, source: heroSrc(me), target: hero(me), amount: after - h.health || amount, healthBefore: h.health, healthAfter: after, fx: 'holy' }];
    }
    case '死亡：单个':
      return t ? [deathEv(1, opp, t, tIndex)] : null;
    case '死亡：同时三个':
      return theirs.length >= 2 ? theirs.slice(0, 3).map((m, i) => deathEv(1, opp, m, i)) : null;
    case '冻结：单个':
      return t ? [{ kind: 'freeze', group: 1, source: heroSrc(me), target: ref(opp, t), frozenAt: v.turn, fx: 'frost' }] : null;
    case '冻结：群体':
      return theirs.length ? theirs.map((m) => ({ kind: 'freeze', group: 1, source: heroSrc(me), target: ref(opp, m), frozenAt: v.turn, fx: 'frost' }) as PresentationEvent) : null;
    case '解冻': {
      // 先冻上，再解冻（两组）
      if (!t) return null;
      return [
        { kind: 'freeze', group: 1, source: heroSrc(me), target: ref(opp, t), frozenAt: v.turn, fx: 'frost' },
        { kind: 'unfreeze', group: 2, target: ref(opp, t), reason: 'turn_end' },
      ];
    }
    case '圣盾：获得':
      return t ? [buffEv(1, opp, t, 0, 0, ['divine_shield'])] : null;
    case '圣盾：打破': {
      // 先获得圣盾，再被法术打破（两组）
      if (!t) return null;
      return [
        buffEv(1, opp, t, 0, 0, ['divine_shield']),
        { kind: 'damage', group: 2, source: heroSrc(me), target: ref(opp, t), amount: 0, shieldAbsorbed: amount, healthBefore: t.health, healthAfter: t.health, lethalPrevented: false, fx: 'fire' },
        { kind: 'shield_broken', group: 2, target: ref(opp, t) },
      ];
    }
    case '潜行：进入':
      return a ? [buffEv(1, me, a, 0, 0, ['stealth'])] : null;
    case '潜行：进入再失去（攻击后）':
      if (!a || !t) return null;
      return [
        buffEv(1, me, a, 0, 0, ['stealth']),
        { kind: 'attack', group: 2, attacker: ref(me, a), target: ref(opp, t) },
        damageEv(2, src(me, a), ref(opp, t), t.health, Math.min(a.attack, t.health - 1) || 1, 'physical'),
        damageEv(2, src(opp, t), ref(me, a), a.health, Math.min(t.attack, a.health - 1) || 1, 'physical'),
        { kind: 'stealth_lost', group: 2, target: ref(me, a) },
      ];
    case '增益：单个':
      return a ? [buffEv(1, me, a, amount, amount)] : null;
    case '增益：群体':
      return mine.length ? mine.map((m) => buffEv(1, me, m, 1, 1)) : null;
    case '减益':
      return t ? [{ ...buffEv(1, opp, t, -Math.min(amount, t.attack), 0), source: heroSrc(me) }] : null;
    case '沉默（带嘲讽、圣盾）': {
      if (!t) return null;
      const def = getCard(t.cardId);
      const shielded = { ...t, keywords: [...t.keywords, 'taunt', 'divine_shield'] as Keyword[] };
      return [
        buffEv(1, opp, t, 0, 0, ['taunt', 'divine_shield']),
        {
          kind: 'silence', group: 2, source: heroSrc(me), target: ref(opp, t),
          attackBefore: t.attack, attackAfter: def.attack ?? t.attack, healthBefore: t.health, healthAfter: Math.min(t.health, def.health ?? t.health),
          maxHealthBefore: t.maxHealth, maxHealthAfter: def.health ?? t.maxHealth, keywordsLost: [...shielded.keywords], fx: 'shadow',
        },
      ];
    }
  }
}

// 满场压力测试（spec 5.10）：双方各 7 个随从。返回改好场面的显示局面
export function fullBoard(v: ViewState, cardIds: readonly string[]): ViewState {
  const pick = (i: number) => cardIds[i % cardIds.length];
  const make = (i: number): ViewMinion => {
    const def = getCard(pick(i));
    return { instanceId: nextId++, cardId: def.id, attack: def.attack ?? 1, health: def.health ?? 1, maxHealth: def.health ?? 1, keywords: [], frozen: false, silenced: false };
  };
  return {
    ...v,
    players: v.players.map((p, s) => ({ ...p, board: Array.from({ length: 7 }, (_, i) => make(i + s * 7)) })) as ViewState['players'],
  };
}

// 满场：14 个随从同时受伤（一组），再同时死亡（一组）
export function fullBoardWipe(v: ViewState): PresentationEvent[] {
  const all = ([0, 1] as Side[]).flatMap((side) => v.players[side].board.map((m, i) => ({ side, m, i })));
  return [
    ...all.map(({ side, m }) => damageEv(1, heroSrc(v.viewer), ref(side, m), m.health, Math.max(m.health, 5), 'fire', true)),
    ...all.map(({ side, m, i }) => deathEv(2, side, m, i)),
  ];
}
