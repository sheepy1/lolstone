// L0 对 L0 冒烟：至少 200 局不同种子，不报错、不卡死、turn 不超过 120。
// 每一步之后的不变量检查由 tests/setup.ts 打开。
import { describe, expect, it } from 'vitest';
import { playL0Game } from '../src/ai/selfplay';
import { PRESET_DECKS } from '../src/cards';
import type { HeroClass } from '../src/engine';

describe('L0 对 L0 冒烟', () => {
  it('200 局不同种子都能打完，turn 不超过 120', () => {
    const classes: HeroClass[] = ['demacia', 'freljord'];
    const results = [];
    for (let seed = 1; seed <= 200; seed++) {
      const pair: [HeroClass, HeroClass] = [classes[seed % 2], classes[(seed + 1) % 2]];
      const r = playL0Game({
        seed,
        classes: pair,
        decks: [[...PRESET_DECKS[pair[0]]!], [...PRESET_DECKS[pair[1]]!]],
        maxActions: 5000,
      });
      expect(r.state.phase).toBe('over');
      expect(r.turns, `seed ${seed}`).toBeLessThanOrEqual(120);
      results.push(r);
    }
    const winners = new Set(results.map((r) => String(r.winner)));
    expect(winners.has('0') && winners.has('1')).toBe(true);
  });
});
