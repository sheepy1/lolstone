// 出牌、攻击、英雄技能、死亡结算、胜负（spec 2.4、2.5、2.6、2.10）。
import type { Action } from './actions';
import { getCard, getHeroClass } from './cardDb';
import {
  emit,
  findMinion,
  GameOverSignal,
  isDoomed,
  minionRef,
  minionSource,
  newGroup,
  type Ctx,
} from './context';
import { runActions, type EffectEnv } from './effects';
import { dealDamage } from './effects/damage';
import type { SourceRef, TriggerTiming } from './events';
import { hasKeyword, triggeredEffects } from './keywords';
import { createMinion } from './minion';
import { getScript } from './scripts';
import { HERO_POWER_COST, type MinionState, type Side, type TargetRef, type TriggeredEffect } from './state';

// 运行随从身上的一个触发效果：先发 trigger 事件，再执行动作。不做死亡结算。
export function runMinionEffect(
  ctx: Ctx,
  side: Side,
  minion: MinionState,
  eff: TriggeredEffect,
  timing: TriggerTiming,
  chosen: TargetRef | null,
  summon: EffectEnv['summon'],
  snapshot: MinionState | null = null,
): void {
  const source = minionSource(side, minion);
  emit(ctx, newGroup(ctx), { kind: 'trigger', source, timing, target: chosen, script: null });
  runActions(ctx, {
    source,
    side,
    selfId: minion.instanceId,
    selfSnapshot: snapshot,
    chosen,
    isSpell: false,
    summon,
    summonVia: 'effect',
  }, eff.actions);
}

// 死亡结算（spec 2.6）：生命值小于等于 0 或被消灭的随从同时离场，按入场顺序触发亡语，
// 再触发 on_kill；有新的死亡就重复，最后判定胜负。
export function resolveDeaths(ctx: Ctx): void {
  const state = ctx.state;
  for (;;) {
    const dead: { side: Side; index: number; minion: MinionState }[] = [];
    // 亡语召唤位置用的排序键：活着的随从是原位置，亡语召唤出来的排在死者原位置之前一点
    const keys = new Map<number, number>();
    for (const side of [0, 1] as const) {
      state.players[side].board.forEach((m, index) => {
        if (isDoomed(m)) dead.push({ side, index, minion: m });
        else keys.set(m.instanceId, index);
      });
    }
    if (dead.length === 0) break;
    dead.sort((a, b) => a.minion.summonOrder - b.minion.summonOrder);

    const group = newGroup(ctx);
    for (const side of [0, 1] as const) {
      state.players[side].board = state.players[side].board.filter((m) => !isDoomed(m));
    }
    for (const d of dead) {
      emit(ctx, group, { kind: 'death', target: minionRef(d.side, d.minion), cardId: d.minion.cardId, position: d.index });
    }

    let tokenCounter = 0;
    for (const d of dead) {
      for (const eff of triggeredEffects(d.minion, 'deathrattle')) {
        const board = state.players[d.side].board;
        const index = board.filter((m) => (keys.get(m.instanceId) ?? Infinity) < d.index).length;
        const before = new Set(board.map((m) => m.instanceId));
        runMinionEffect(ctx, d.side, d.minion, eff, 'deathrattle', null, { mode: 'at', index }, d.minion);
        for (const m of state.players[d.side].board) {
          if (!before.has(m.instanceId) && !keys.has(m.instanceId)) {
            keys.set(m.instanceId, d.index - 0.5 + 0.001 * tokenCounter++);
          }
        }
      }
    }

    const deadIds = new Set(dead.map((d) => d.minion.instanceId));
    const killers = ctx.kills
      .filter((k) => deadIds.has(k.victim))
      .map((k) => findMinion(state, k.killer))
      .filter((loc) => loc !== null)
      .sort((a, b) => a.minion.summonOrder - b.minion.summonOrder);
    ctx.kills = ctx.kills.filter((k) => !deadIds.has(k.victim));
    for (const loc of killers) {
      // 前面的效果可能已经让它离场；自己也将死的不触发
      if (!findMinion(state, loc.minion.instanceId) || isDoomed(loc.minion)) continue;
      for (const eff of triggeredEffects(loc.minion, 'on_kill')) {
        runMinionEffect(ctx, loc.side, loc.minion, eff, 'on_kill', null, { mode: 'rightmost' });
      }
    }
  }
  ctx.kills = [];
  checkGameOver(ctx);
}

// 胜负（spec 2.10）：一方英雄生命值小于等于 0，另一方获胜；双方同时则平局。
function checkGameOver(ctx: Ctx): void {
  const [a, b] = ctx.state.players;
  const dead0 = a.hero.health <= 0;
  const dead1 = b.hero.health <= 0;
  if (!dead0 && !dead1) return;
  const winner = dead0 && dead1 ? 'draw' : dead0 ? 1 : 0;
  ctx.state.phase = 'over';
  ctx.state.winner = winner;
  emit(ctx, newGroup(ctx), { kind: 'game_over', winner });
  throw new GameOverSignal();
}

function payMana(ctx: Ctx, side: Side, cost: number, reason: 'play_card' | 'hero_power'): void {
  const mana = ctx.state.players[side].mana;
  const before = { ...mana };
  mana.current -= cost;
  mana.temp = Math.min(mana.temp, mana.current);
  emit(ctx, newGroup(ctx), { kind: 'mana_changed', side, before, after: { ...mana }, reason });
}

// 从手牌打出一张牌（spec 2.4）。合法性已经检查过。
export function playCard(ctx: Ctx, action: Extract<Action, { kind: 'play_card' }>): void {
  const state = ctx.state;
  const side = state.current;
  const p = state.players[side];
  const card = p.hand[action.handIndex];
  const def = getCard(card.cardId);
  const target = action.target ?? null;
  const comboActive = p.cardsPlayedThisTurn > 0; // 连击：本回合已经使用过其他牌
  p.hand = p.hand.filter((_, i) => i !== action.handIndex);
  p.cardsPlayedThisTurn += 1;

  emit(ctx, newGroup(ctx), {
    kind: 'card_played',
    side,
    card,
    cardType: def.type === 'minion' ? 'minion' : 'spell',
    handIndex: action.handIndex,
    cost: def.cost,
    position: def.type === 'minion' ? (action.position ?? p.board.length) : null,
    target,
  });
  payMana(ctx, side, def.cost, 'play_card');

  if (def.type === 'minion') {
    const position = action.position ?? p.board.length;
    const m = createMinion(ctx, card.cardId, card.instanceId);
    p.board = [...p.board.slice(0, position), m, ...p.board.slice(position)];
    emit(ctx, newGroup(ctx), {
      kind: 'minion_summoned',
      side,
      target: minionRef(side, m),
      cardId: m.cardId,
      position,
      via: 'play',
      attack: m.attack,
      health: m.health,
      source: null,
      fx: null,
    });
    const timings: ('battlecry' | 'combo')[] = comboActive ? ['battlecry', 'combo'] : ['battlecry'];
    for (const timing of timings) {
      for (const eff of triggeredEffects(m, timing)) {
        if (!findMinion(state, m.instanceId)) break;
        // 需要目标的战吼没选到目标（没有合法目标）就跳过
        if (eff.target && !target) continue;
        runMinionEffect(ctx, side, m, eff, timing, eff.target ? target : null, { mode: 'right_of_self' });
        resolveDeaths(ctx);
      }
    }
    return;
  }

  // 法术
  emit(ctx, newGroup(ctx), { kind: 'spell_cast', side, card, target });
  const source: SourceRef = { kind: 'spell', side, instanceId: card.instanceId, cardId: card.cardId };
  for (const eff of def.effects ?? []) {
    if (eff.trigger !== 'cast') continue;
    runActions(ctx, {
      source,
      side,
      selfId: null,
      selfSnapshot: null,
      chosen: eff.target ? target : null,
      isSpell: true,
      summon: { mode: 'rightmost' },
      summonVia: 'effect',
    }, eff.actions);
    resolveDeaths(ctx);
  }
}

// 使用英雄技能（spec 2.4）：每回合一次，2 费，目标规则和法术一样，不吃法术伤害。
export function useHeroPower(ctx: Ctx, action: Extract<Action, { kind: 'hero_power' }>): void {
  const side = ctx.state.current;
  const p = ctx.state.players[side];
  const def = getCard(getHeroClass(p.heroClass).heroPower);
  const target = action.target ?? null;
  p.heroPowerUsed = true;
  payMana(ctx, side, HERO_POWER_COST, 'hero_power');
  emit(ctx, newGroup(ctx), { kind: 'hero_power_used', side, cardId: def.id, target });
  const source: SourceRef = { kind: 'hero_power', side, cardId: def.id };
  for (const eff of def.effects ?? []) {
    if (eff.trigger !== 'cast') continue;
    runActions(ctx, {
      source,
      side,
      selfId: null,
      selfSnapshot: null,
      chosen: eff.target ? target : null,
      isSpell: false,
      summon: { mode: 'rightmost' },
      summonVia: 'hero_power',
    }, eff.actions);
    resolveDeaths(ctx);
  }
}

// 攻击（spec 2.5）：双方同时按自身攻击力对对方造成伤害，英雄不反击。攻击之后攻击方失去潜行。
export function attack(ctx: Ctx, action: Extract<Action, { kind: 'attack' }>): void {
  const state = ctx.state;
  const side = state.current;
  const attackerRef = action.attacker as Extract<TargetRef, { kind: 'minion' }>;
  const a = findMinion(state, attackerRef.instanceId)!.minion;
  const group = newGroup(ctx);
  emit(ctx, group, { kind: 'attack', attacker: attackerRef, target: action.target });
  a.attacksThisTurn += 1;

  const aSource = minionSource(side, a);
  const attackAmount = a.attack;
  if (action.target.kind === 'minion') {
    const d = findMinion(state, action.target.instanceId)!.minion;
    let counter = d.attack;
    const hook = a.silenced ? undefined : getScript(getCard(a.cardId).script)?.attackerCounterDamage;
    if (hook && counter > 0) {
      counter = hook(a, counter);
      emit(ctx, group, { kind: 'trigger', source: aSource, timing: 'script', target: null, script: getCard(a.cardId).script ?? null });
    }
    dealDamage(ctx, group, aSource, a, action.target, attackAmount, 'physical');
    dealDamage(ctx, group, minionSource(action.target.side, d), d, attackerRef, counter, 'physical');
  } else {
    dealDamage(ctx, group, aSource, a, action.target, attackAmount, 'physical');
  }

  if (hasKeyword(a, 'stealth')) {
    a.keywords = a.keywords.filter((k) => k !== 'stealth');
    emit(ctx, group, { kind: 'stealth_lost', target: attackerRef });
  }
  resolveDeaths(ctx);
}
