// 回合流程（spec 2.3）。
import { emit, minionRef, newGroup, type Ctx } from './context';
import { expireTurnBuffs } from './effects/buff';
import { drawCard } from './effects/draw';
import { triggeredEffects } from './keywords';
import { resolveDeaths, runMinionEffect } from './resolve';
import { MAX_MANA, other, type Side } from './state';

// 回合开始：法力上限 +1 并回满，触发回合开始效果，抽一张牌。
export function startTurn(ctx: Ctx, side: Side, turn: number): void {
  const state = ctx.state;
  state.turn = turn;
  state.current = side;
  const p = state.players[side];
  p.heroPowerUsed = false;
  p.cardsPlayedThisTurn = 0;
  for (const m of p.board) m.attacksThisTurn = 0;
  emit(ctx, newGroup(ctx), { kind: 'turn_start', side, turn });

  const before = { ...p.mana };
  p.mana.max = Math.min(MAX_MANA, p.mana.max + 1);
  p.mana.current = p.mana.max;
  p.mana.temp = 0;
  emit(ctx, newGroup(ctx), { kind: 'mana_changed', side, before, after: { ...p.mana }, reason: 'turn_start' });

  runTurnTriggers(ctx, side, 'turn_start');
  drawCard(ctx, newGroup(ctx), side);
  resolveDeaths(ctx);
}

// 回合结束：触发回合结束效果，"本回合"的增益消失，按 spec 2.7 解冻，然后轮到对方。
export function endTurn(ctx: Ctx): void {
  const state = ctx.state;
  const side = state.current;
  const p = state.players[side];
  emit(ctx, newGroup(ctx), { kind: 'turn_end', side, turn: state.turn });
  runTurnTriggers(ctx, side, 'turn_end');

  expireTurnBuffs(ctx, newGroup(ctx));
  const unfreezeGroup = newGroup(ctx);
  for (const m of p.board) {
    if (m.frozenAt !== undefined && m.frozenAt < state.turn) {
      delete m.frozenAt;
      emit(ctx, unfreezeGroup, { kind: 'unfreeze', target: minionRef(side, m), reason: 'turn_end' });
    }
  }
  for (const s of [0, 1] as const) for (const m of state.players[s].board) m.extraAttacks = 0;
  if (p.mana.temp > 0) {
    const before = { ...p.mana };
    p.mana.temp = 0;
    p.mana.current = Math.min(p.mana.current, p.mana.max);
    emit(ctx, newGroup(ctx), { kind: 'mana_changed', side, before, after: { ...p.mana }, reason: 'turn_end' });
  }
  startTurn(ctx, other(side), state.turn + 1);
}

// 拥有者的回合开始/结束效果，多个随从按入场顺序触发，每个效果之后做死亡结算。
function runTurnTriggers(ctx: Ctx, side: Side, timing: 'turn_start' | 'turn_end'): void {
  const order = [...ctx.state.players[side].board].sort((a, b) => a.summonOrder - b.summonOrder);
  for (const m of order) {
    for (const eff of triggeredEffects(m, timing)) {
      // 前面的效果可能已经让它离场或被变形
      if (!ctx.state.players[side].board.includes(m)) break;
      runMinionEffect(ctx, side, m, eff, timing, null, { mode: 'rightmost' });
      resolveDeaths(ctx);
    }
  }
}
