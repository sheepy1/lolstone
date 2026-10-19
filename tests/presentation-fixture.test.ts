// 回放夹具（spec 6.7）：固定种子录的一局 L0 对 L0。导演回放它，断言每个事件都按原顺序播到、
// 同组事件在同一步里，回放完显示局面停在对局结束。
// 重新录制：pnpm fixture:record（卡池或引擎事件改了之后）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_DECKS } from '../src/cards';
import { maskEvents, type GameEventKind } from '../src/engine';
import { Director, type Step } from '../src/presentation/director';
import type { PresentationEvent } from '../src/presentation/events';
import { recordL0Game, type ReplayFixture } from '../src/presentation/fixture';

const FILE = path.join(import.meta.dirname, 'fixtures/l0-replay.json');
const SEED = 181;

function record(): ReplayFixture {
  return recordL0Game(SEED, ['freljord', 'demacia'], [[...PRESET_DECKS.freljord!], [...PRESET_DECKS.demacia!]], 0);
}

if (process.env.MELOL_RECORD_FIXTURE || !existsSync(FILE)) {
  writeFileSync(FILE, `${JSON.stringify(record())}\n`);
}

const fixture: ReplayFixture = JSON.parse(readFileSync(FILE, 'utf8'));

describe('回放夹具', () => {
  it('覆盖的事件类型', () => {
    const kinds = new Set(fixture.batches.flatMap((b) => b.events.map((e) => e.kind)));
    // M1 的两套预组打不出回手和失去潜行，这两种由 presentation-director 的构造事件覆盖
    const expected: GameEventKind[] = [
      'mulligan_start', 'mulligan_done', 'game_start', 'turn_start', 'turn_end', 'draw', 'card_played',
      'minion_summoned', 'spell_cast', 'hero_power_used', 'trigger', 'attack', 'damage', 'death', 'buff',
      'freeze', 'unfreeze', 'mana_changed', 'game_over',
    ];
    for (const k of expected) expect(kinds.has(k), k).toBe(true);
  });

  it('导演回放：不漏事件、不乱序，同组事件在同一步', async () => {
    const steps: Step[] = [];
    const d = new Director(fixture.initialView, async (step) => {
      steps.push(step);
      await Promise.resolve();
    });
    const sent: PresentationEvent[] = [];
    for (const b of fixture.batches) {
      const masked = maskEvents(b.events, fixture.viewer);
      sent.push(...masked);
      d.enqueue(masked);
    }
    await d.whenIdle();
    const played = steps.flatMap((s) => s.events);
    expect(played).toEqual(sent);
    for (const s of steps) expect(new Set(s.events.map((e) => e.group)).size).toBe(1);
    // 同一批里同一个 group 只出现在一步里（引擎保证同组事件相邻）
    const seen = new Set<string>();
    for (const s of steps) {
      const key = `${s.batch}:${s.group}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    expect(d.displayed.phase).toBe('over');
    expect(d.displayed.winner).toBe(fixture.winner);
  });
});
