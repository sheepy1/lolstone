// 隔离环境加载（docs/online.md 9.5、5.7）：把打包后的 dist-logic/logic.js 装进 node:vm 造的上下文，里面只有 ES 内置对象
// 加注入的 structuredClone（没有 Date、console、process、定时器，Math.random 一调就抛），用一个按平台协议跑的假 runner
// 让两个 L0 机器人打完一局。中途把 MatchState 序列化再装回一个新加载的模块接着打（模拟 runner 重启），结果要和
// 不中断的一致。顺带核对 runner 的限制：一次 apply 50 ms、一个座位一条批次 60 KiB、State 1 MB。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildLogic, type LogicBuild } from '../scripts/build-logic';
import type { GameEvent } from '../src/engine';
import type { Logic, MatchState, Step } from '../src/logic';

type L = Logic<MatchState, GameEvent>;
type S = Step<MatchState, GameEvent>;

const APPLY_LIMIT_MS = 50;
const BATCH_LIMIT = 60 * 1024;
const STATE_LIMIT = 1024 * 1024;
const BOT_DELAY_MS = 1000;

let bundle: LogicBuild;
let source: string;

beforeAll(async () => {
  bundle = await buildLogic();
  source = readFileSync(bundle.file, 'utf8');
}, 60_000);

// 每次调用都新建一个上下文、重新加载一遍模块，就像 runner 重启后重新装模块
function loadIsolated(): L {
  const context = vm.createContext({ structuredClone });
  vm.runInContext(
    // V8 的新上下文自带 console 和 WebAssembly，平台的隔离环境没有，一并删掉
    `delete globalThis.Date;
     delete globalThis.console;
     delete globalThis.WebAssembly;
     Math.random = () => { throw new Error('Math.random is not available in the isolate'); };`,
    context,
  );
  // 打出来的是 ES 模块，结尾是 export { logic }。vm 跑 ES 模块要实验开关，这里把导出换成挂到上下文的全局上
  const exportTail = /export\s*\{\s*logic\s*\};?\s*$/;
  expect(source).toMatch(exportTail);
  vm.runInContext(source.replace(exportTail, 'globalThis.__logic = logic;'), context, { filename: 'logic.js' });
  const globals = vm.runInContext(
    `[typeof Date, typeof console, typeof process, typeof setTimeout, typeof fetch, typeof window, typeof document]`,
    context,
  ) as string[];
  expect(globals.every((t) => t === 'undefined')).toBe(true);
  return (context as { __logic: L }).__logic;
}

type Batch = { version: number; cause: string; events: unknown[]; snapshot: unknown; deadlineIn: number | null };
type Stats = { steps: number; timeouts: number; maxApplyMs: number; maxBotMs: number; maxBatch: number; maxState: number };

// 假 runner，按协议 §2.4 推进：setup 之后 version 为 0，每一步成功加一；每一步之后按座位号问 bot，
// 有动作就等 botDelayMs 再走 apply；计时到点按座位号依次调 onTimeout，带回新 deadline 的那一步之后就停。
// 时钟是假的：只在等 bot 和等到期时往前拨。stall(version) 为真时这一步之后 bot 不出手，让计时器到点
class FakeRunner {
  state!: MatchState;
  version = 0;
  clock = 0;
  deadline: number | null = null;
  readonly inbox: [Batch[], Batch[]] = [[], []];
  readonly stats: Stats = { steps: 0, timeouts: 0, maxApplyMs: 0, maxBotMs: 0, maxBatch: 0, maxState: 0 };

  constructor(
    public logic: L,
    readonly stall: (version: number) => boolean,
  ) {}

  setup(seed: number): void {
    const r = this.logic.setup({
      seed,
      seats: [
        { kind: 'bot', config: { level: 'L0', heroClass: 'demacia' } },
        { kind: 'bot', config: { level: 'L0', heroClass: 'freljord' } },
      ],
      options: null,
    });
    if (!r.ok) throw new Error(`setup rejected: ${r.reason}`);
    this.state = r.state;
    this.setDeadline(r.deadline);
    this.deliver(r.events, 'setup');
  }

  // 跑到对局结束；restartAt 是要在哪个 version 之后模拟 runner 重启
  run(restartAt: number | null = null): void {
    for (let guard = 0; guard < 2000 && !this.logic.result(this.state); guard++) {
      if (restartAt !== null && this.version >= restartAt) {
        this.restart();
        restartAt = null;
      }
      const next = this.stall(this.version) ? null : this.askBots();
      if (next && (this.deadline === null || this.clock + BOT_DELAY_MS < this.deadline)) {
        this.clock += BOT_DELAY_MS;
        const t0 = performance.now();
        const r = this.logic.apply(this.state, next.seat, next.action);
        this.stats.maxApplyMs = Math.max(this.stats.maxApplyMs, performance.now() - t0);
        if (!r.ok) throw new Error(`bot action rejected: ${r.reason}`);
        this.commit(r, 'bot');
        continue;
      }
      if (this.deadline === null) throw new Error('match is stuck: no bot action and no timer');
      this.clock = this.deadline;
      this.timeoutRound();
    }
  }

  // runner 重启：平台存的是序列化后的 MatchState 和 version，新的 runner 重新加载模块再装回去
  private restart(): void {
    this.state = JSON.parse(JSON.stringify(this.state)) as MatchState;
    this.logic = loadIsolated();
  }

  private askBots(): { seat: number; action: unknown } | null {
    for (const seat of [0, 1]) {
      const t0 = performance.now();
      const action = this.logic.bot!(this.state, seat);
      this.stats.maxBotMs = Math.max(this.stats.maxBotMs, performance.now() - t0);
      if (action !== null && action !== undefined) return { seat, action };
    }
    return null;
  }

  private timeoutRound(): void {
    this.deadline = null;
    for (const seat of [0, 1]) {
      const r = this.logic.onTimeout(this.state, seat);
      if (!r.ok) continue;
      this.stats.timeouts++;
      this.commit(r, 'timeout');
      if (typeof r.deadline === 'number') break;
    }
  }

  private commit(step: Extract<S, { ok: true }>, cause: string): void {
    const json = JSON.stringify(step.state);
    this.stats.maxState = Math.max(this.stats.maxState, json.length);
    this.state = step.state;
    this.version++;
    this.stats.steps++;
    this.setDeadline(step.deadline);
    this.deliver(step.events, cause);
  }

  private setDeadline(deadline: number | null | undefined): void {
    if (deadline !== undefined) this.deadline = deadline === null ? null : this.clock + deadline;
  }

  private deliver(events: GameEvent[], cause: string): void {
    for (const seat of [0, 1] as const) {
      const batch: Batch = {
        version: this.version,
        cause,
        events: this.logic.maskEvents(events, seat),
        snapshot: this.logic.mask(this.state, seat),
        deadlineIn: this.deadline === null ? null : this.deadline - this.clock,
      };
      const size = new TextEncoder().encode(JSON.stringify(batch)).length;
      this.stats.maxBatch = Math.max(this.stats.maxBatch, size);
      this.inbox[seat].push(JSON.parse(JSON.stringify(batch)) as Batch);
    }
  }
}

// 开局让换牌到点，之后每 17 步里有一步 bot 不出手，回合计时到点
const stall = (version: number) => version === 0 || version % 17 === 9;

describe('打包后的逻辑模块在隔离环境里', () => {
  it('是一个不超过 2 MB 的单文件，没有 import，引用不到隔离环境里没有的全局对象', () => {
    expect(bundle.bytes).toBeLessThan(2 * 1024 * 1024);
    expect(source).not.toMatch(/^\s*import\s/m);
    for (const name of ['process', 'window', 'document', 'fetch', 'setTimeout', 'Math.random']) {
      expect(source.includes(name), name).toBe(false);
    }
  });

  it('两个 L0 机器人在假 runner 里打完一局；中途重启 runner 装回序列化的局面，结果和不中断的一致', () => {
    const straight = new FakeRunner(loadIsolated(), stall);
    straight.setup(42);
    straight.run();
    const result = straight.logic.result(straight.state);
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(['reason', 'winner']);
    expect(straight.version).toBe(straight.stats.steps);
    expect(straight.stats.timeouts).toBeGreaterThanOrEqual(3);
    // 每个座位收到的 version 连续
    for (const inbox of straight.inbox) expect(inbox.map((b) => b.version)).toEqual(inbox.map((_, i) => i));

    const restarted = new FakeRunner(loadIsolated(), stall);
    restarted.setup(42);
    restarted.run(Math.floor(straight.version / 2));
    expect(restarted.version).toBe(straight.version);
    expect(JSON.stringify(restarted.state)).toBe(JSON.stringify(straight.state));
    expect(JSON.stringify(restarted.logic.result(restarted.state))).toBe(JSON.stringify(result));
    expect(JSON.stringify(restarted.inbox)).toBe(JSON.stringify(straight.inbox));

    // runner 的限制（online.md 5.7）
    const s = straight.stats;
    expect(s.maxApplyMs).toBeLessThan(APPLY_LIMIT_MS);
    expect(s.maxBotMs).toBeLessThan(APPLY_LIMIT_MS);
    expect(s.maxBatch).toBeLessThan(BATCH_LIMIT);
    expect(s.maxState).toBeLessThan(STATE_LIMIT);
    console.log(
      `[logic-isolate] bundle ${(bundle.bytes / 1024).toFixed(1)} KB, ${s.steps} steps, ${s.timeouts} timeouts, ` +
        `apply max ${s.maxApplyMs.toFixed(2)} ms, bot max ${s.maxBotMs.toFixed(2)} ms, ` +
        `batch max ${(s.maxBatch / 1024).toFixed(1)} KB, state max ${(s.maxState / 1024).toFixed(1)} KB`,
    );
  });
});
