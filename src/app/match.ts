// 对局层：持有真实局面，执行玩家动作，驱动 AI，把遮过的事件交给导演（spec 5.8、6.4、6.6）。
// - 合法操作永远来自真实局面的 listLegalActions；显示局面追上之前、对方回合里返回 null（锁定输入）。
// - AI 只看 maskHidden 过的局面选动作，动作在真实局面上执行。AI 的两个动作之间往队列插一个
//   ai_thinking 等待事件。
// - 表现层只吃 maskEvents 遮过的事件。
import { l1ChooseAction } from '../ai/l1';
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
  thinkSeconds?: number;
};

const MAX_AI_ACTIONS_PER_TURN = 200;

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
    // 不指定时每个动作前随机 0.5 到 1.5 秒（m4-storyboard E27：时长随机，不然像机器）。用自己的随机数，不影响 AI 的选择
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

  private push(events: GameEvent[]): void {
    const masked = maskEvents(events, this.human);
    this.onBatch?.(masked, this.state);
    this.director?.enqueue(masked);
  }

  private nextThink(): number {
    if (this.thinkSeconds !== null) return this.thinkSeconds;
    const [f, next] = nextFloat(this.thinkRng);
    this.thinkRng = next;
    return 0.5 + f;
  }

  private aiToAct(): boolean {
    const s = this.state;
    if (s.phase === 'mulligan') return !s.players[this.aiSide].mulliganDone;
    return s.phase === 'playing' && s.current === this.aiSide;
  }

  // AI 连续行动直到轮到玩家或对局结束。AI 瞬间算完，事件全部进队列，由导演按节奏播。
  private runAi(): void {
    let n = 0;
    while (this.aiToAct()) {
      if (n++ > MAX_AI_ACTIONS_PER_TURN) throw new Error('AI did not end its turn');
      const choice = this.ai(maskHidden(this.state, this.aiSide), this.aiSide, this.aiRng);
      if (!choice) throw new Error('AI has no legal action');
      this.aiRng = choice.rng;
      const r = applyAction(this.state, choice.action);
      if (!r.ok) throw new Error(`AI action rejected: ${r.error}`);
      if (this.state.phase === 'playing') {
        const wait: PresentationEvent = { kind: 'ai_thinking', group: 0, side: this.aiSide, seconds: this.nextThink() };
        this.onBatch?.([wait], this.state);
        this.director?.enqueue([wait]);
      }
      this.state = r.state;
      this.push(r.events);
    }
  }
}
