// 客户端座位（docs/online.md 3.2）：GameApp 只认这个接口。单机的实现是 LocalMatch（浏览器里直接持有一个 Table，
// 对手是 AI 座位），联机的实现是 RemoteMatch（M6b，接平台的对局）。
import type { Action, GameState, Side } from '../engine';
import type { Director } from '../presentation/director';
import type { PresentationEvent } from '../presentation/events';
import type { ViewState } from '../presentation/viewState';
import type { MatchResult } from '../server/table';

export type MatchSeat = {
  readonly side: Side; // 我是哪一方
  readonly initial: ViewState; // 开局（或重连时）的显示局面
  // 我看到的局面：联机是平台发来的遮过的快照，单机是真实局面。合法操作永远在它上面算。
  // 它的 rng 不可用（联机时是 0），单机也不要拿它模拟；自动驾驶和 AI 有自己的随机数流
  readonly visible: GameState;
  readonly over: boolean;
  readonly result: MatchResult | null;
  humanToAct(): boolean; // 轮到我行动（换牌阶段：我还没提交）
  legalActions(): Action[] | null; // 导演忙、不轮到我、上一个动作还没回包时为 null，表示锁定
  submit(action: Action): string | null; // 不合法返回原因，不改局面
  concede(): void;
  start(director: Director): void;
  stop(): void;
  onBatch: ((events: PresentationEvent[], state: GameState) => void) | null; // 对局日志用
};
