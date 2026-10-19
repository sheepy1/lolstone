// AI 思考（m4-storyboard E27）的衔接：对局层发 ai_thinking 时，如果下一步是出牌，就带上那张牌的实例 id，
// 表现层抬起的就是这一张、再直接飞出。这里核对带的 id 确实就是紧接着打出的那张，不是出牌时不带。
import { describe, expect, it } from 'vitest';
import { Match } from '../src/app/match';
import { PRESET_DECKS } from '../src/cards';
import type { Director } from '../src/presentation/director';
import type { PresentationEvent } from '../src/presentation/events';

describe('ai_thinking 带下一张要打出的牌', () => {
  it('带了 card 的思考之后紧接着打出的就是这张；不是出牌的思考不带', () => {
    for (const seed of [3, 11, 4243]) {
      const batches: PresentationEvent[][] = [];
      const director = { busy: false, enqueue: (e: PresentationEvent[]) => batches.push([...e]) } as unknown as Director;
      const match = new Match({ seed, classes: ['demacia', 'noxus'], decks: [[...PRESET_DECKS.demacia!], [...PRESET_DECKS.noxus!]], human: 0 });
      match.start(director);
      // 我方只换牌和结束回合，让 AI 出够多的牌
      for (let i = 0; i < 30 && !match.over; i++) {
        const legal = match.legalActions();
        if (!legal) break;
        match.submit(legal.find((a) => a.kind === 'mulligan') ?? legal.find((a) => a.kind === 'end_turn')!);
      }
      let checked = 0;
      batches.forEach((b, i) => {
        const wait = b[0];
        if (b.length !== 1 || wait.kind !== 'ai_thinking') return;
        const next = batches[i + 1]?.[0];
        if (wait.card !== undefined) {
          expect(next?.kind).toBe('card_played');
          if (next?.kind === 'card_played') expect(next.card.instanceId).toBe(wait.card);
          checked++;
        } else {
          expect(next?.kind).not.toBe('card_played');
        }
      });
      expect(checked, `种子 ${seed} 里 AI 一张牌都没出`).toBeGreaterThan(0);
    }
  });
});
