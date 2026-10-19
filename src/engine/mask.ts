// 隐藏信息（spec 4.2、4.5、6.3）。引擎内部局面是完整的，给某一方看或给 AI 模拟时用这里遮。
import { forkRng } from './rng';
import { HIDDEN_CARD_ID, other, type GameState, type Side } from './state';

const MASK_SALT = 0x6d61736b;

// 遮掉对方手牌和双方牌库：卡牌 id 换成占位牌，实例 id 保留（手牌张数、哪张是新抽的仍然可见）。
// 对方还没执行的换牌选择也去掉。随机数换成派生流，模拟时无法预知真实对局的随机结果。
export function maskHidden(state: GameState, viewer: Side): GameState {
  const s: GameState = structuredClone(state);
  const opp = s.players[other(viewer)];
  opp.hand = opp.hand.map((c) => ({ instanceId: c.instanceId, cardId: HIDDEN_CARD_ID }));
  if (opp.mulliganReplace) opp.mulliganReplace = [];
  for (const p of s.players) {
    p.deck = p.deck.map((c) => ({ instanceId: c.instanceId, cardId: HIDDEN_CARD_ID }));
  }
  s.rng = forkRng(state, MASK_SALT);
  return s;
}

// 给界面看的局面，和 maskHidden 相同。
export const visibleState = maskHidden;
