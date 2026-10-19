// 隐藏信息（spec 4.2、4.5、6.3）。引擎内部局面是完整的，给某一方看或给 AI 模拟时用这里遮。
import type { GameEvent } from './events';
import { forkRng } from './rng';
import { HIDDEN_CARD_ID, other, type CardInstance, type GameState, type Side } from './state';

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

const hide = (c: CardInstance): CardInstance => ({ instanceId: c.instanceId, cardId: HIDDEN_CARD_ID });

// 遮掉事件里对方手牌的内容，和 maskHidden 遮的范围一致：对方起手、对方换掉和新抽的牌、对方抽到的牌
// 换成占位牌，实例 id 保留。回到对方手牌的那张牌也遮：它刚在场上、玩家知道是什么，但 maskHidden
// 遮过的局面里它是占位牌，两边保持一致，显示局面追上真实局面时才对得上。
// 公开的信息不遮：打出的牌、爆掉的牌（双方都看得到）。不改入参，不需要遮的事件原样返回同一个对象。
export function maskEvents(events: readonly GameEvent[], viewer: Side): GameEvent[] {
  const opp = other(viewer);
  return events.map((e): GameEvent => {
    switch (e.kind) {
      case 'mulligan_start': {
        const hands: [CardInstance[], CardInstance[]] = [e.hands[0], e.hands[1]];
        hands[opp] = hands[opp].map(hide);
        return { ...e, hands };
      }
      case 'mulligan_done':
        return e.side === opp ? { ...e, replaced: e.replaced.map(hide), drawn: e.drawn.map(hide) } : e;
      case 'draw':
        return e.side === opp ? { ...e, card: hide(e.card) } : e;
      case 'bounce':
        return e.target.side === opp && e.card ? { ...e, card: hide(e.card) } : e;
      default:
        return e;
    }
  });
}
