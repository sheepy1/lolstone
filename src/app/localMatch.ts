// 单机对局（docs/online.md 3.1、第 6 节）：浏览器里直接持有一个权威对局 Table，我方是真人座位，对手是 AI 座位。
// - 合法操作来自真实局面的 listLegalActions；显示局面追上之前、对方回合里返回 null（锁定输入）。
// - AI 只看 maskHidden 过的局面选动作，动作走和玩家一样的 Table.submit。AI 的两个动作之间 Table 插一个
//   ai_thinking 等待事件。
// - 表现层只吃 maskEvents 遮过的事件，由 Table 发给我方座位。
import { l1ChooseAction } from '../ai/l1';
import type { AsyncChooseAction } from '../ai/l2Worker';
import type { ChooseAction } from '../ai/types';
import { listLegalActions, seedRng, type Action, type GameState, type HeroClass, type Side } from '../engine';
import type { Director } from '../presentation/director';
import type { PresentationEvent } from '../presentation/events';
import { initialView, type ViewState } from '../presentation/viewState';
import { Table, type Batch, type MatchResult, type Seat } from '../server/table';
import type { MatchSeat } from './seat';

// AI 接口：看遮过的局面，返回动作和推进后的随机数流。默认 L1。
export type AiPolicy = ChooseAction;

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

export class LocalMatch implements MatchSeat {
  readonly side: Side;
  readonly initial: ViewState;
  readonly table: Table;
  private director: Director | null = null;
  // 每批事件交给导演之前调用（对局日志用）
  onBatch: ((events: PresentationEvent[], state: GameState) => void) | null = null;

  constructor(readonly config: MatchConfig) {
    this.side = config.human;
    const aiSeat: Seat = { kind: 'ai', choose: config.aiAsync ?? config.ai ?? l1ChooseAction, rng: seedRng(config.seed ^ 0x5eed) };
    const mySeat: Seat = { kind: 'human', deliver: (b) => this.receive(b) };
    const seats: [Seat, Seat] = config.human === 0 ? [mySeat, aiSeat] : [aiSeat, mySeat];
    this.table = new Table({ seed: config.seed, classes: config.classes, decks: config.decks, seats, thinkSeconds: config.thinkSeconds });
    this.initial = initialView(this.visible, this.side);
  }

  // 单机直接看真实局面（online.md 3.2）
  get visible(): GameState {
    return this.table.state.game;
  }

  get over(): boolean {
    return this.visible.phase === 'over';
  }

  get result(): MatchResult | null {
    return this.table.result();
  }

  // 接上导演并开始：发开局事件，AI 先提交换牌。
  start(director: Director): void {
    this.director = director;
    this.table.start();
  }

  // 现在轮到玩家行动吗（不管动画）。
  humanToAct(): boolean {
    const s = this.visible;
    if (s.phase === 'mulligan') return !s.players[this.side].mulliganDone;
    return s.phase === 'playing' && s.current === this.side;
  }

  // 玩家现在能做的事。动画没播完（显示局面没追上）或者不是玩家行动时返回 null。
  legalActions(): Action[] | null {
    if (!this.director || this.director.busy || !this.humanToAct()) return null;
    return listLegalActions(this.visible, this.side);
  }

  // 执行玩家动作。不合法（包括锁定期间）返回错误说明，不改局面。
  submit(action: Action): string | null {
    if (!this.legalActions()) return 'input locked';
    const r = this.table.submit(this.side, this.table.version, action);
    return r.ok ? null : r.reason;
  }

  // 认输（spec 5.1 对局菜单）：走 Table 的认输动作，真实局面记为对手获胜，发和正常分出胜负时一样的 game_over 事件，
  // 表现层照常播失败演出、弹结算面板。之后 humanToAct 为 false，输入锁定。
  concede(): void {
    if (this.over) return;
    this.table.submit(this.side, this.table.version, { kind: 'concede' });
  }

  // 离开这一局（回主菜单、开新局）时调用：Worker 里还没算完的 L2 结果回来后直接丢掉，
  // 不再往已经销毁的场景和下一局的战斗日志里推事件。
  stop(): void {
    this.table.stop();
    this.director = null;
    this.onBatch = null;
  }

  private receive(batch: Batch): void {
    this.onBatch?.(batch.events, this.visible);
    this.director?.enqueue(batch.events);
  }
}
