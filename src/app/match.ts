// 对局层：持有真实局面，执行玩家动作，驱动 AI，把遮过的事件交给导演（spec 5.8、6.4、6.6）。
// - 合法操作永远来自真实局面的 listLegalActions；显示局面追上之前、对方回合里返回 null（锁定输入）。
// - AI 只看 maskHidden 过的局面选动作，动作在真实局面上执行。AI 的两个动作之间往队列插一个
//   ai_thinking 等待事件。
// - 表现层只吃 maskEvents 遮过的事件。
import { l1ChooseAction } from '../ai/l1';
import type { AsyncChooseAction } from '../ai/l2Worker';
import {
  applyAction,
  checkAction,
  createGame,
  listLegalActions,
  maskEvents,
  maskHidden,
  other,
  nextFloat,
  seedRng,
  type Action,
  type GameEvent,
  type GameState,
  type HeroClass,
  type RngState,
  type Side,
} from '../engine';
import type { Director } from '../presentation/director';
import type { PresentationEvent } from '../presentation/events';
import { initialView, type ViewState } from '../presentation/viewState';

// AI 接口（src/ai/types.ts 的 ChooseAction）：看遮过的局面，返回动作和推进后的随机数流。默认 L1。
export type AiPolicy = (state: GameState, side: Side, rng: RngState) => { action: Action; rng: RngState } | null;

export type MatchConfig = {
  seed: number;
  classes: [HeroClass, HeroClass];
  decks: [string[], string[]];
  human: Side;
  ai?: AiPolicy;
  // 异步的 AI（L2 放在 Web Worker 里算）。给了就用它，不用 ai
  aiAsync?: AsyncChooseAction;
  thinkSeconds?: number;
};

const MAX_AI_ACTIONS_PER_TURN = 200;

// AI 每个动作前的思考时间（m4-storyboard E27，用户 2026-10-20 定"越往后越短"）：同一个对手回合里，第一个动作前
// 随机 first 到 firstMax 秒，之后每个动作乘 decay 逐步缩短，最短 floor 秒；每次再加减 jitter 的比例，不像机器。
// 目标是动作多的回合也不超过 10 秒（m4-first-minutes 第 7 步）。调试台 /dev/fx 的"回合流程"面板可调
// 决定结束回合（已经没有别的可做）前只停 endTurn 秒
export const AI_PACE = { first: 0.8, firstMax: 1.5, decay: 0.6, floor: 0.4, jitter: 0.15, endTurn: 0.2 };

export class Match {
  state: GameState;
  readonly human: Side;
  readonly aiSide: Side;
  readonly initial: ViewState;
  private director: Director | null = null;
  private aiRng: RngState;
  private readonly ai: AiPolicy;
  private readonly thinkSeconds: number | null;
  private thinkRng: RngState;
  private pendingStart: GameEvent[];
  // 每批事件交给导演之前调用（对局日志用）
  onBatch: ((events: PresentationEvent[], state: GameState) => void) | null = null;

  constructor(readonly config: MatchConfig) {
    const created = createGame({ seed: config.seed, classes: config.classes, decks: config.decks });
    this.state = created.state;
    this.pendingStart = created.events;
    this.human = config.human;
    this.aiSide = other(config.human);
    this.ai = config.ai ?? l1ChooseAction;
    // 不指定时按 AI_PACE 算（越往后越短）。用自己的随机数，不影响 AI 的选择
    this.thinkSeconds = config.thinkSeconds ?? null;
    this.thinkRng = seedRng(config.seed ^ 0x7417);
    this.aiRng = seedRng(config.seed ^ 0x5eed);
    this.initial = initialView(this.state, this.human);
  }

  // 接上导演并开始：发开局事件，AI 先提交换牌（只有一方提交时引擎不发事件）。
  start(director: Director): void {
    this.director = director;
    this.push(this.pendingStart);
    this.pendingStart = [];
    this.runAi();
  }

  get over(): boolean {
    return this.state.phase === 'over';
  }

  // 现在轮到玩家行动吗（不管动画）。
  humanToAct(): boolean {
    const s = this.state;
    if (s.phase === 'mulligan') return !s.players[this.human].mulliganDone;
    return s.phase === 'playing' && s.current === this.human;
  }

  // 玩家现在能做的事。动画没播完（显示局面没追上）或者不是玩家行动时返回 null。
  legalActions(): Action[] | null {
    if (!this.director || this.director.busy || !this.humanToAct()) return null;
    return listLegalActions(this.state, this.human);
  }

  // 执行玩家动作。不合法（包括锁定期间）返回错误说明，不改局面。
  submit(action: Action): string | null {
    if (!this.legalActions()) return 'input locked';
    const err = checkAction(this.state, action);
    if (err) return err;
    const r = applyAction(this.state, action);
    if (!r.ok) return r.error;
    this.state = r.state;
    this.push(r.events);
    this.runAi();
    return null;
  }

  // 认输（spec 5.1 对局菜单）：真实局面直接记为对手获胜，发和正常分出胜负时一样的 game_over 事件，
  // 表现层照常播失败演出、弹结算面板。之后 humanToAct 为 false，输入锁定。
  concede(): void {
    if (this.over) return;
    this.state = { ...this.state, phase: 'over', winner: this.aiSide };
    this.push([{ kind: 'game_over', group: 0, winner: this.aiSide }]);
  }

  private push(events: GameEvent[]): void {
    const masked = maskEvents(events, this.human);
    this.onBatch?.(masked, this.state);
    this.director?.enqueue(masked);
  }

  private rand(): number {
    const [f, next] = nextFloat(this.thinkRng);
    this.thinkRng = next;
    return f;
  }

  // 这个对手回合里第 k 个动作（从 0 数）前的思考时间。first 是这一回合第一个动作的思考时间
  private nextThink(k: number, first: number): number {
    if (this.thinkSeconds !== null) return this.thinkSeconds;
    const P = AI_PACE;
    if (k === 0) return first;
    const base = Math.max(P.floor, first * Math.pow(P.decay, k));
    return Math.max(P.floor * (1 - P.jitter), base * (1 + (this.rand() * 2 - 1) * P.jitter));
  }

  private aiToAct(): boolean {
    const s = this.state;
    if (s.phase === 'mulligan') return !s.players[this.aiSide].mulliganDone;
    return s.phase === 'playing' && s.current === this.aiSide;
  }

  // AI 连续行动直到轮到玩家或对局结束。AI 瞬间算完，事件全部进队列，由导演按节奏播。
  private runAi(): void {
    if (this.config.aiAsync) {
      void this.runAiAsync().catch((e) => console.error('[ai]', e));
      return;
    }
    let n = 0;
    const turn = this.newAiTurn();
    while (this.aiToAct()) {
      if (n++ > MAX_AI_ACTIONS_PER_TURN) throw new Error('AI did not end its turn');
      const choice = this.ai(maskHidden(this.state, this.aiSide), this.aiSide, this.aiRng);
      this.applyAi(choice, turn);
    }
  }

  // 异步的 AI（Worker 里的 L2）：每一步等它算完再执行。等的时候导演照常播上一步的动画，
  // 算的时间藏在动画和思考停顿里。等待期间局面被换掉（认输）就作废这次结果
  private aiRunning = false;
  private async runAiAsync(): Promise<void> {
    if (this.aiRunning) return;
    this.aiRunning = true;
    try {
      let n = 0;
      const turn = this.newAiTurn();
      while (this.aiToAct()) {
        if (n++ > MAX_AI_ACTIONS_PER_TURN) throw new Error('AI did not end its turn');
        const asked = this.state;
        const choice = await this.config.aiAsync!(maskHidden(asked, this.aiSide), this.aiSide, this.aiRng);
        if (this.state !== asked) return;
        this.applyAi(choice, turn);
      }
    } finally {
      this.aiRunning = false;
    }
  }

  // 一个 AI 回合的思考节奏：第一个动作前的思考时间，和这一回合已经思考过几次
  private newAiTurn(): { k: number; first: number } {
    return { k: 0, first: AI_PACE.first + this.rand() * (AI_PACE.firstMax - AI_PACE.first) };
  }

  private applyAi(choice: { action: Action; rng: RngState } | null, turn: { k: number; first: number }): void {
    if (!choice) throw new Error('AI has no legal action');
    this.aiRng = choice.rng;
    const r = applyAction(this.state, choice.action);
    if (!r.ok) throw new Error(`AI action rejected: ${r.error}`);
    if (this.state.phase === 'playing') {
      const wait: PresentationEvent = { kind: 'ai_thinking', group: 0, side: this.aiSide, seconds: choice.action.kind === 'end_turn' ? AI_PACE.endTurn : this.nextThink(turn.k++, turn.first) };
      this.onBatch?.([wait], this.state);
      this.director?.enqueue([wait]);
    }
    this.state = r.state;
    this.push(r.events);
  }
}
