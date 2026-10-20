// 逻辑模块的局面和对外的形状（docs/online.md 4.1、4.2、4.5）。全部是纯 JSON。
import type { Action, GameState, Side } from '../engine';

// 对局结束的原因（online.md 4.1 的 result）。invalid_deck 是 setup 时卡组不合规、那一方直接判负（5.4）
export type EndReason = 'game' | 'concede' | 'timeout' | 'abandon' | 'kicked' | 'invalid_deck';
export type MatchResult = { winner: Side | 'draw'; reason: EndReason };

// 认输不进引擎，是模块级的动作（online.md 4.2）
export type ConcedeAction = { kind: 'concede' };
export type MatchAction = Action | ConcedeAction;

// 动作日志的一条。隔离环境里没有时钟，所以不记时间；什么时候发生的由平台的整局记录给（第 7 节）。
// 计时到点替玩家做的动作也记在这里（by 为 timeout），重放时和玩家自己发的一样执行
export type LogEntry = { seat: Side; action: MatchAction; by?: 'timeout' };

// bot 座位的等级（online.md 5.6）：L2 的搜索超过一次调用 50 ms 的限制，只留在单机
export type BotLevel = 'L0' | 'L1';

// 引擎局面外面包一层（online.md 4.1）：动作日志、结束原因、每个座位是不是 bot（不是为 null）
export type MatchState = {
  game: GameState;
  log: LogEntry[];
  reason: EndReason | null;
  bots: [BotLevel | null, BotLevel | null];
};

// 发给一个座位的快照（online.md 4.5）：遮过的局面，rng 置零，带上结束原因。动作日志和 bots 不下发
export type Snapshot = { game: GameState; reason: EndReason | null };
