// L0 对 L0 冒烟：四个职业的 16 种先后手组合，每种 200 个不同种子，不报错、不卡死、turn 不超过 120。
// 每一步之后的不变量检查由 tests/setup.ts 打开。
import { describe, expect, it } from 'vitest';
import { playL0Game } from '../src/ai/selfplay';
import { PRESET_DECKS } from '../src/cards';
import type { HeroClass } from '../src/engine';

const CLASSES: HeroClass[] = ['demacia', 'noxus', 'ionia', 'freljord'];
const GAMES_PER_PAIR = 200;

describe('L0 对 L0 冒烟', () => {
  for (const a of CLASSES) {
    for (const b of CLASSES) {
      it(`${a} 对 ${b}：${GAMES_PER_PAIR} 局都能打完，turn 不超过 120`, () => {
        const winners = new Set<string>();
        for (let seed = 1; seed <= GAMES_PER_PAIR; seed++) {
          const r = playL0Game({
            seed,
            classes: [a, b],
            decks: [[...PRESET_DECKS[a]], [...PRESET_DECKS[b]]],
            maxActions: 5000,
          });
          expect(r.state.phase).toBe('over');
          expect(r.turns, `seed ${seed}`).toBeLessThanOrEqual(120);
          winners.add(String(r.winner));
        }
        expect(winners.has('0') && winners.has('1')).toBe(true);
      });
    }
  }
});
