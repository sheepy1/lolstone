// 导演：串行播放、同组并行、不漏事件；显示局面追上之后和真实局面一致。
import { describe, expect, it } from 'vitest';
import { playL0Game } from '../src/ai/selfplay';
import { PRESET_DECKS } from '../src/cards';
import { createGame, maskEvents, type GameEvent, type HeroClass } from '../src/engine';
import { composeStep, startTimes } from '../src/presentation/compose';
import { Director, splitSteps, type Step } from '../src/presentation/director';
import type { PresentationEvent } from '../src/presentation/events';
import { initialView, reduceView, viewFromState, type ViewState } from '../src/presentation/viewState';
import gsap from 'gsap';

const decks = (a: HeroClass, b: HeroClass): [string[], string[]] => [[...PRESET_DECKS[a]!], [...PRESET_DECKS[b]!]];

const ev = (kind: 'game_start' | 'turn_end', group: number): PresentationEvent =>
  kind === 'game_start' ? { kind, group, first: 0 } : { kind, group, side: 0, turn: 1 };

function blankView(): ViewState {
  const { state } = createGame({ seed: 1, classes: ['demacia', 'freljord'], decks: decks('demacia', 'freljord') });
  return initialView(state, 0);
}

// 记录型播放器：每一步记下开始和结束顺序，播放时长由测试控制。
function recorder() {
  const log: string[] = [];
  const steps: Step[] = [];
  const pending: (() => void)[] = [];
  const play = (step: Step) => {
    steps.push(step);
    log.push(`start ${step.batch}:${step.group}`);
    return new Promise<void>((resolve) =>
      pending.push(() => {
        log.push(`end ${step.batch}:${step.group}`);
        resolve();
      }),
    );
  };
  const finishNext = async () => {
    pending.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { log, steps, pending, play, finishNext };
}

describe('splitSteps', () => {
  it('同一批里相邻、group 相同的事件合成一步', () => {
    const steps = splitSteps(1, [ev('game_start', 0), ev('turn_end', 0), ev('game_start', 1), ev('turn_end', 2), ev('turn_end', 2)]);
    expect(steps.map((s) => [s.group, s.events.length])).toEqual([
      [0, 2],
      [1, 1],
      [2, 2],
    ]);
  });

  it('不同批的事件即使 group 相同也不合并（group 只在一次 applyAction 里唯一）', async () => {
    const r = recorder();
    const d = new Director(blankView(), r.play);
    d.enqueue([ev('game_start', 0)]);
    d.enqueue([ev('turn_end', 0)]);
    await r.finishNext();
    await r.finishNext();
    expect(r.steps.map((s) => [s.batch, s.group, s.events.length])).toEqual([
      [1, 0, 1],
      [2, 0, 1],
    ]);
  });
});

describe('Director', () => {
  it('串行：前一步播完才开始下一步；busy 直到队列播空', async () => {
    const r = recorder();
    const d = new Director(blankView(), r.play);
    d.enqueue([ev('game_start', 0), ev('turn_end', 1)]);
    d.enqueue([ev('turn_end', 0)]);
    expect(d.busy).toBe(true);
    expect(r.log).toEqual(['start 1:0']);
    await r.finishNext();
    expect(r.log).toEqual(['start 1:0', 'end 1:0', 'start 1:1']);
    await r.finishNext();
    await r.finishNext();
    expect(r.log).toEqual(['start 1:0', 'end 1:0', 'start 1:1', 'end 1:1', 'start 2:0', 'end 2:0']);
    expect(d.busy).toBe(false);
    await d.whenIdle();
  });

  it('显示局面在一步播完后才推进', async () => {
    const r = recorder();
    const d = new Director(blankView(), r.play);
    expect(d.displayed.phase).toBe('mulligan');
    d.enqueue([ev('game_start', 0)]);
    expect(d.displayed.phase).toBe('mulligan');
    await r.finishNext();
    expect(d.displayed.phase).toBe('playing');
  });

  it('播放器出错时记下错误、照样推进，不卡住队列', async () => {
    const d = new Director(blankView(), () => Promise.reject(new Error('boom')));
    const origError = console.error;
    console.error = () => {};
    d.enqueue([ev('game_start', 0)]);
    d.enqueue([ev('turn_end', 0)]);
    await d.whenIdle();
    console.error = origError;
    expect(d.errors).toHaveLength(2);
    expect(d.displayed.phase).toBe('playing');
  });
});

describe('composeStep', () => {
  const seg = (d: number) => gsap.timeline().to({}, { duration: d });

  it('同一步的事件并行：都从 0 开始', () => {
    const master = composeStep([{ tl: seg(0.4) }, { tl: seg(0.3) }, { tl: seg(0.5) }]);
    expect(startTimes(master)).toEqual([0, 0, 0]);
    expect(master.duration()).toBeCloseTo(0.5);
  });

  it('有攻击（带 impact）时，其余事件从撞击时刻开始', () => {
    const master = composeStep([{ tl: seg(0.6), impact: 0.29 }, { tl: seg(0.4) }, { tl: seg(0.4) }]);
    const t = startTimes(master);
    expect(t[0]).toBe(0);
    expect(t[1]).toBeCloseTo(0.29);
    expect(t[2]).toBeCloseTo(0.29);
  });
});

describe('显示局面', () => {
  it('L0 对 L0：每批事件推进完，显示局面和真实局面（遮过）一致', () => {
    for (const [seed, a, b] of [
      [11, 'demacia', 'freljord'],
      [12, 'freljord', 'demacia'],
      [13, 'freljord', 'freljord'],
      [14, 'demacia', 'demacia'],
    ] as const) {
      for (const viewer of [0, 1] as const) {
        let view: ViewState | null = null;
        playL0Game({
          seed,
          classes: [a, b],
          decks: decks(a, b),
          onEvents: (events, state) => {
            if (!view) {
              // 第一批是开局：createGame 之后的局面去掉手牌
              const s0 = structuredClone(state);
              view = initialView(s0, viewer);
            }
            for (const e of maskEvents(events, viewer)) view = reduceView(view, e);
            // 一方先提交换牌时引擎不发事件（NOTES「换牌」），显示局面的 mulliganDone 要等 mulligan_done 才变
            const real = viewFromState(state, viewer);
            if (real.phase === 'mulligan') for (const p of real.players) p.mulliganDone = false;
            expect(view).toEqual(real);
          },
        });
      }
    }
  });

  it('引擎事件以外的 ai_thinking 不改显示局面', () => {
    const v = blankView();
    expect(reduceView(v, { kind: 'ai_thinking', group: 0, side: 1, seconds: 0.5 })).toEqual(v);
  });

  it('回手和失去潜行（M1 卡组打不出来，用构造的事件）', () => {
    let v = blankView();
    v = reduceView(v, { kind: 'game_start', group: 0, first: 0 });
    v = reduceView(v, {
      kind: 'minion_summoned', group: 0, side: 1, target: { side: 1, kind: 'minion', instanceId: 900 },
      cardId: 'neutral.teemo', position: 0, via: 'play', attack: 1, health: 1, source: null, fx: null,
    } as GameEvent);
    expect(v.players[1].board[0].keywords).toContain('stealth');
    v = reduceView(v, { kind: 'stealth_lost', group: 0, target: { side: 1, kind: 'minion', instanceId: 900 } });
    expect(v.players[1].board[0].keywords).not.toContain('stealth');
    v = reduceView(v, {
      kind: 'bounce', group: 0, source: { kind: 'hero', side: 0 }, target: { side: 1, kind: 'minion', instanceId: 900 },
      cardId: 'neutral.teemo', position: 0, handIndex: 0, destroyed: false, card: { instanceId: 900, cardId: 'hidden' }, fx: 'shadow',
    });
    expect(v.players[1].board).toHaveLength(0);
    expect(v.players[1].hand[0]).toEqual({ instanceId: 900, cardId: 'hidden' });
  });
});
