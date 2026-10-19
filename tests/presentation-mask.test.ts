// maskEvents：表现层只吃遮过的事件，对方手牌的内容不能出现在事件里。
import { describe, expect, it } from 'vitest';
import { playL0Game } from '../src/ai/selfplay';
import { PRESET_DECKS } from '../src/cards';
import { HIDDEN_CARD_ID, maskEvents, maskHidden, type GameEvent, type Side } from '../src/engine';

const decks = (): [string[], string[]] => [[...PRESET_DECKS.demacia!], [...PRESET_DECKS.freljord!]];

function recordBatches(seed: number): { events: GameEvent[]; state: Parameters<typeof maskHidden>[0] }[] {
  const out: { events: GameEvent[]; state: Parameters<typeof maskHidden>[0] }[] = [];
  playL0Game({ seed, classes: ['demacia', 'freljord'], decks: decks(), onEvents: (events, state) => out.push({ events, state }) });
  return out;
}

// 事件里出现的、属于 side 手牌的牌（起手、换牌、抽牌、回手）
function handCards(e: GameEvent, side: Side) {
  switch (e.kind) {
    case 'mulligan_start':
      return e.hands[side];
    case 'mulligan_done':
      return e.side === side ? [...e.replaced, ...e.drawn] : [];
    case 'draw':
      return e.side === side ? [e.card] : [];
    case 'bounce':
      return e.target.side === side && e.card ? [e.card] : [];
    default:
      return [];
  }
}

describe('maskEvents', () => {
  it('对方起手、换牌、抽到的牌换成占位牌，实例 id 保留；自己的不变', () => {
    for (const seed of [1, 2, 3]) {
      for (const { events } of recordBatches(seed)) {
        const masked = maskEvents(events, 0);
        expect(masked).toHaveLength(events.length);
        masked.forEach((m, i) => {
          const opp = handCards(m, 1);
          expect(opp.every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
          expect(opp.map((c) => c.instanceId)).toEqual(handCards(events[i], 1).map((c) => c.instanceId));
          expect(handCards(m, 0)).toEqual(handCards(events[i], 0));
        });
      }
    }
  });

  it('不改入参；没有要遮的事件原样返回', () => {
    const [{ events }] = recordBatches(4);
    const copy = structuredClone(events);
    const masked = maskEvents(events, 1);
    expect(events).toEqual(copy);
    const start = events.find((e) => e.kind === 'mulligan_start')!;
    expect(masked.find((e) => e.kind === 'mulligan_start')).not.toBe(start);
    const r = maskEvents([{ kind: 'game_start', group: 0, first: 0 }], 1);
    expect(r[0]).toEqual({ kind: 'game_start', group: 0, first: 0 });
  });

  it('打出的牌和爆掉的牌是公开信息，不遮', () => {
    const played: GameEvent = {
      kind: 'card_played', group: 0, side: 1, card: { instanceId: 9, cardId: 'demacia.lux' },
      cardType: 'minion', handIndex: 0, cost: 4, position: 0, target: null,
    };
    const burned: GameEvent = { kind: 'burn', group: 1, side: 1, card: { instanceId: 10, cardId: 'demacia.poppy' } };
    expect(maskEvents([played, burned], 0)).toEqual([played, burned]);
  });

  it('回到对方手牌的牌也遮，和 maskHidden 遮过的局面一致', () => {
    const e: GameEvent = {
      kind: 'bounce', group: 0, source: { kind: 'hero', side: 0 }, target: { side: 1, kind: 'minion', instanceId: 5 },
      cardId: 'demacia.lux', position: 0, handIndex: 2, destroyed: false, card: { instanceId: 5, cardId: 'demacia.lux' }, fx: 'shadow',
    };
    const [m] = maskEvents([e], 0);
    expect(m.kind === 'bounce' && m.card).toEqual({ instanceId: 5, cardId: HIDDEN_CARD_ID });
    expect(maskEvents([e], 1)[0]).toEqual(e);
  });

  it('遮过的事件里没有对方手牌的卡牌 id：和 maskHidden 看到的对方手牌对得上', () => {
    for (const { events, state } of recordBatches(5)) {
      const visible = maskHidden(state, 0).players[1].hand;
      for (const e of maskEvents(events, 0)) {
        for (const c of handCards(e, 1)) expect(c.cardId).toBe(HIDDEN_CARD_ID);
      }
      expect(visible.every((c) => c.cardId === HIDDEN_CARD_ID)).toBe(true);
    }
  });
});
