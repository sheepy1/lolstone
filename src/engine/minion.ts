// 随从的创建。
import { getCard } from './cardDb';
import { allocInstanceId, allocSummonOrder, type Ctx } from './context';
import type { MinionState } from './state';

// 按卡面生成一个全新的随从，视为本回合入场。instanceId 不传时新分配。
export function createMinion(ctx: Ctx, cardId: string, instanceId?: number): MinionState {
  const def = getCard(cardId);
  if (def.type !== 'minion') throw new Error(`not a minion: ${cardId}`);
  return {
    instanceId: instanceId ?? allocInstanceId(ctx),
    cardId,
    attack: def.attack ?? 0,
    health: def.health ?? 1,
    maxHealth: def.health ?? 1,
    buffs: [],
    keywords: [...(def.keywords ?? [])],
    attacksThisTurn: 0,
    enteredTurn: ctx.state.turn,
    silenced: false,
    summonOrder: allocSummonOrder(ctx),
    extraAttacks: 0,
  };
}
