// 执行一个动作期间的上下文。applyAction 先深拷贝局面，之后所有修改都落在 ctx.state 上，
// 所以对外仍然是纯函数：入参不变，返回新局面。
import type { GameEvent, SourceRef } from './events';
import { nextInt } from './rng';
import type { GameState, MinionState, PlayerState, Side, TargetRef } from './state';

export type KillCredit = { victim: number; killer: number };

export type Ctx = {
  state: GameState;
  events: GameEvent[];
  nextGroup: number;
  // 本随从造成的伤害记一笔，死亡结算时据此触发 on_kill（spec 3.4）
  kills: KillCredit[];
};

// 有人获胜或平局时抛出，applyAction 捕获后结束执行。只在引擎内部使用。
export class GameOverSignal {}

export function makeCtx(state: GameState): Ctx {
  return { state, events: [], nextGroup: 0, kills: [] };
}

export function newGroup(ctx: Ctx): number {
  return ctx.nextGroup++;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function emit(ctx: Ctx, group: number, event: DistributiveOmit<GameEvent, 'group'>): void {
  ctx.events.push({ ...event, group } as GameEvent);
}

export function player(ctx: Ctx, side: Side): PlayerState {
  return ctx.state.players[side];
}

export type MinionLocation = { side: Side; index: number; minion: MinionState };

export function findMinion(state: GameState, instanceId: number): MinionLocation | null {
  for (const side of [0, 1] as const) {
    const index = state.players[side].board.findIndex((m) => m.instanceId === instanceId);
    if (index >= 0) return { side, index, minion: state.players[side].board[index] };
  }
  return null;
}

export function minionRef(side: Side, m: { instanceId: number }): TargetRef {
  return { side, kind: 'minion', instanceId: m.instanceId };
}

export function heroRef(side: Side): TargetRef {
  return { side, kind: 'hero' };
}

export function minionSource(side: Side, m: { instanceId: number; cardId: string }): SourceRef {
  return { kind: 'minion', side, instanceId: m.instanceId, cardId: m.cardId };
}

// 目标引用是否还指向场上存在的角色。
export function isRefAlive(state: GameState, ref: TargetRef): boolean {
  if (ref.kind === 'hero') return true;
  const loc = findMinion(state, ref.instanceId);
  return loc !== null && loc.side === ref.side;
}

export function randomInt(ctx: Ctx, n: number): number {
  const [value, rng] = nextInt(ctx.state.rng, n);
  ctx.state.rng = rng;
  return value;
}

export function allocInstanceId(ctx: Ctx): number {
  return ctx.state.nextInstanceId++;
}

export function allocSummonOrder(ctx: Ctx): number {
  return ctx.state.nextSummonOrder++;
}

// 将死而还没离场的随从（生命值小于等于 0，或被消灭、剧毒命中）。
export function isDoomed(m: MinionState): boolean {
  return m.health <= 0 || m.pendingDestroy === true;
}
