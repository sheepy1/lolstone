// 权威对局 Table（docs/online.md 3.1、5.2）：持有真实局面、version、动作日志和两个座位，把动作交给逻辑模块的 apply、
// 把结果按座位遮过再发出去，驱动 AI 座位并在它的动作之间插 ai_thinking。
// 纯模块：不碰 DOM、网络和定时器，浏览器（单机的 LocalMatch）和 Node（测试）都能跑。
//
// Table 只做平台的 runner 在线上做的那部分编排：version、发批次、计时到点按座位依次调 onTimeout、AI 节奏。
// 动作校验、行动方核对、遮蔽、结果都调 src/logic 里和平台同一段代码，Table 自己不做。
import type { AiChoice } from '../ai/types';
import { createGame, maskHidden, nextFloat, seedRng, type GameEvent, type GameState, type HeroClass, type RngState, type Side } from '../engine';
import { applyMatch, maskMatch, maskMatchEvents, matchResult, timeoutMatch, type MatchStep } from '../logic/match';
import type { MatchResult, MatchState, Snapshot } from '../logic/state';
import { MULLIGAN_MS } from '../logic/timeouts';
import type { PresentationEvent } from '../presentation/events';

export type { EndReason, MatchResult, MatchState, Snapshot } from '../logic/state';

// ---------- Table：编排 ----------

// 发给真人座位的一批（online.md 4.3 的 batch）。AI 思考的等待也作为一批单独发，version 和快照不变
export type Batch = { version: number; events: PresentationEvent[]; snapshot: Snapshot; deadlineIn: number | null };

// AI 的选择：看遮过的局面，返回动作和推进后的随机数流。可以是同步的（L0、L1），也可以返回 Promise（Worker 里的 L2）
export type AiChooser = (state: GameState, side: Side, rng: RngState) => AiChoice | null | Promise<AiChoice | null>;

export type Seat = { kind: 'human'; deliver: (batch: Batch) => void } | { kind: 'ai'; choose: AiChooser; rng: RngState };

export type TableConfig = {
  seed: number;
  classes: [HeroClass, HeroClass];
  decks: [string[], string[]];
  seats: [Seat, Seat];
  // AI 每个动作前固定停这么多秒；不给时按 AI_PACE 算
  thinkSeconds?: number;
  // 算计时到期时刻用的时钟。默认 Date.now，测试里可以换成固定的
  now?: () => number;
};

export type SubmitResult = { ok: true } | { ok: false; reason: string };

const MAX_AI_ACTIONS_PER_TURN = 200;

// AI 每个动作前的思考时间（m4-storyboard E27，用户 2026-10-20 定"越往后越短"）：同一个对手回合里，第一个动作前
// 随机 first 到 firstMax 秒，之后每个动作乘 decay 逐步缩短，最短 floor 秒；每次再加减 jitter 的比例，不像机器。
// 目标是动作多的回合也不超过 10 秒（m4-first-minutes 第 7 步）。调试台 /dev/fx 的"回合流程"面板可调
// 决定结束回合（已经没有别的可做）前只停 endTurn 秒
export const AI_PACE = { first: 0.8, firstMax: 1.5, decay: 0.6, floor: 0.4, jitter: 0.15, endTurn: 0.2 };

type AiTurn = { k: number; first: number };

export class Table {
  state: MatchState;
  // 已执行的动作数（online.md 4.4）：开局为 0，每次成功执行加一
  version = 0;
  readonly seats: [Seat, Seat];
  // 当前计时的到期时刻（online.md 5.3），没有计时为 null。Table 不开定时器：到点由调用方调 timeout()，
  // 单机不限时、从不调；batch 的 deadlineIn 按它算
  deadline: number | null = null;
  private readonly aiRng: [RngState | null, RngState | null];
  private readonly thinkSeconds: number | null;
  private thinkRng: RngState;
  private readonly now: () => number;
  private opening: GameEvent[] | null;
  private aiBusy = false;
  private stopped = false;

  constructor(config: TableConfig) {
    const created = createGame({ seed: config.seed, classes: config.classes, decks: config.decks });
    // 单机的 AI 座位由 Table 自己驱动（能接 Worker 里的 L2），不用逻辑模块的 bot，所以 bots 都是 null
    this.state = { game: created.state, log: [], reason: null, bots: [null, null] };
    this.opening = created.events;
    this.seats = config.seats;
    this.aiRng = [seatRng(config.seats[0]), seatRng(config.seats[1])];
    // 思考时间用自己的随机数，不影响 AI 的选择
    this.thinkSeconds = config.thinkSeconds ?? null;
    this.thinkRng = seedRng(config.seed ^ 0x7417);
    this.now = config.now ?? Date.now;
    // 和逻辑模块的 setup 一样，换牌从开局起计 60 秒
    this.deadline = this.now() + MULLIGAN_MS;
  }

  // 发开局那批事件，然后让该行动的 AI 座位行动（换牌阶段 AI 先提交；只有一方提交时引擎不发事件）
  start(): void {
    if (!this.opening) return;
    const events = this.opening;
    this.opening = null;
    this.deliver(events);
    this.driveAi();
  }

  // 一个座位提交动作（online.md 5.2）。version 不是当前的拒 'stale'；其余校验都在逻辑模块的 apply 里。
  // AI 座位的动作也走这里。
  submit(seat: Side, version: number, action: unknown): SubmitResult {
    if (version !== this.version) return { ok: false, reason: 'stale' };
    const r = applyMatch(this.state, seat, action);
    if (!r.ok) return r;
    this.commit(r);
    this.driveAi();
    return { ok: true };
  }

  // 计时到点（online.md 4.1、5.3），和平台的 runner 做法一样：按座位号依次调 onTimeout，每次传上一次之后的局面；
  // 生效的各算一步，某一步带回新的 deadline 就停。这一轮没有一步带回新计时，计时器停掉
  timeout(): void {
    if (this.deadline === null) return;
    this.deadline = null;
    for (const seat of [0, 1] as const) {
      const r = timeoutMatch(this.state, seat);
      if (!r.ok) continue;
      this.commit(r);
      if (typeof r.deadline === 'number') break;
    }
    this.driveAi();
  }

  snapshotFor(seat: Side): Snapshot {
    return maskMatch(this.state, seat);
  }

  result(): MatchResult | null {
    return matchResult(this.state);
  }

  // 离开这一局时调用：Worker 里还没算完的 L2 结果回来后直接丢掉，不再发批次
  stop(): void {
    this.stopped = true;
  }

  // 一步生效：换局面、version 加一、按 Step 的 deadline 更新计时（不带就保留），再发给每个座位
  private commit(step: MatchStep & { ok: true }): void {
    this.state = step.state;
    this.version++;
    if (step.deadline !== undefined) this.deadline = step.deadline === null ? null : this.now() + step.deadline;
    this.deliver(step.events);
  }

  // 给每个真人座位各发一份遮过的事件和快照。AI 座位不收：它的"收"是轮到它时 driveAi 去调 choose
  private deliver(events: GameEvent[]): void {
    this.seats.forEach((seat, side) => {
      if (seat.kind !== 'human') return;
      const s = side as Side;
      seat.deliver({ version: this.version, events: maskMatchEvents(events, s), snapshot: this.snapshotFor(s), deadlineIn: this.deadlineIn() });
    });
  }

  private sendToHumans(event: PresentationEvent): void {
    this.seats.forEach((seat, side) => {
      if (seat.kind === 'human') seat.deliver({ version: this.version, events: [event], snapshot: this.snapshotFor(side as Side), deadlineIn: this.deadlineIn() });
    });
  }

  private deadlineIn(): number | null {
    return this.deadline === null ? null : Math.max(0, this.deadline - this.now());
  }

  // 现在该行动的 AI 座位，没有时为 null
  private aiToAct(): Side | null {
    const g = this.state.game;
    for (const side of [0, 1] as const) {
      if (this.seats[side].kind !== 'ai') continue;
      if (g.phase === 'mulligan' && !g.players[side].mulliganDone) return side;
      if (g.phase === 'playing' && g.current === side) return side;
    }
    return null;
  }

  // AI 连续行动直到轮到真人或对局结束。同步的 AI 瞬间算完，事件全部发出去，由导演按节奏播；
  // 异步的 AI（Worker 里的 L2）每一步等它算完再执行，等的时候导演照常播上一步的动画，算的时间藏在动画和思考停顿里。
  // 正在驱动时（AI 自己的 submit 会再调进来，或者 Worker 还没回）直接返回，由正在跑的那一轮接着走。
  private driveAi(): void {
    if (this.aiBusy || this.stopped) return;
    this.aiBusy = true;
    this.runAi(this.newAiTurn(), 0);
  }

  // 驱动的主循环。n 是这一轮已经走了几步。遇到异步的 AI 就挂起，算完后从这里接着走（同一个思考节奏）
  private runAi(turn: AiTurn, n: number): void {
    try {
      for (let side = this.aiToAct(); side !== null; side = this.aiToAct()) {
        if (n++ > MAX_AI_ACTIONS_PER_TURN) throw new Error('AI did not end its turn');
        const seat = this.seats[side] as Extract<Seat, { kind: 'ai' }>;
        const asked = this.state;
        const choice = seat.choose(maskHidden(asked.game, side), side, this.aiRng[side]!);
        if (isPromise(choice)) {
          this.awaitAi(choice, side, asked, turn, n);
          return;
        }
        this.playAi(side, choice, turn);
      }
    } catch (e) {
      this.aiBusy = false;
      throw e;
    }
    this.aiBusy = false;
  }

  private awaitAi(pending: Promise<AiChoice | null>, side: Side, asked: MatchState, turn: AiTurn, n: number): void {
    pending
      .then((choice) => {
        // 等待期间局面被换掉（认输）或离开了这一局就作废这次结果
        if (this.stopped || this.state !== asked) {
          this.aiBusy = false;
          return;
        }
        this.playAi(side, choice, turn);
        this.runAi(turn, n);
      })
      .catch((e) => {
        this.aiBusy = false;
        console.error('[ai]', e);
      });
  }

  // 执行 AI 的一步：对局阶段先给真人座位发一个 ai_thinking 等待，再走和真人一样的 submit
  private playAi(side: Side, choice: AiChoice | null, turn: AiTurn): void {
    if (!choice) throw new Error('AI has no legal action');
    this.aiRng[side] = choice.rng;
    const game = this.state.game;
    if (game.phase === 'playing') {
      const seconds = choice.action.kind === 'end_turn' ? AI_PACE.endTurn : this.nextThink(turn.k++, turn.first);
      // 下一步是出牌时带上那张牌的实例 id：思考时抬起的就是它，然后直接从抬起的状态飞出
      const next = choice.action.kind === 'play_card' ? game.players[side].hand[choice.action.handIndex]?.instanceId : undefined;
      this.sendToHumans({ kind: 'ai_thinking', group: 0, side, seconds, ...(next !== undefined ? { card: next } : {}) });
    }
    const r = this.submit(side, this.version, choice.action);
    if (!r.ok) throw new Error(`AI action rejected: ${r.reason}`);
  }

  private rand(): number {
    const [f, next] = nextFloat(this.thinkRng);
    this.thinkRng = next;
    return f;
  }

  // 一个 AI 回合的思考节奏：第一个动作前的思考时间，和这一回合已经思考过几次
  private newAiTurn(): AiTurn {
    return { k: 0, first: AI_PACE.first + this.rand() * (AI_PACE.firstMax - AI_PACE.first) };
  }

  // 这个对手回合里第 k 个动作（从 0 数）前的思考时间。first 是这一回合第一个动作的思考时间
  private nextThink(k: number, first: number): number {
    if (this.thinkSeconds !== null) return this.thinkSeconds;
    const P = AI_PACE;
    if (k === 0) return first;
    const base = Math.max(P.floor, first * Math.pow(P.decay, k));
    return Math.max(P.floor * (1 - P.jitter), base * (1 + (this.rand() * 2 - 1) * P.jitter));
  }
}

function seatRng(seat: Seat): RngState | null {
  return seat.kind === 'ai' ? seat.rng : null;
}

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown } | null)?.then === 'function';
}
