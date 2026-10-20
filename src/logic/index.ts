// 逻辑模块入口（docs/online.md 第 4 节、5.1）：导出满足托管平台 Logic 接口的 logic 对象。
// scripts/build-logic.ts 把这个文件打成不带依赖的单文件 dist-logic/logic.js，交给平台在隔离环境里跑。
//
// 方法的实现在 match.ts，这里只做两件事：
// - 模块加载时装一次卡池（隔离环境里的模块级初始化，平台每个 runner 只跑一次）。
// - 每个方法包一层：seat 不是 0 或 1 的拒掉；实现里意外抛错时兜成 ok:false 'module_error'（mask 等不返回 Step 的
//   方法兜成空结果），对平台保证任何输入都不抛。正常路径不靠这一层，原因不带错误信息，免得把真实局面漏给玩家。
import { installDefaultPool } from '../cards';
import type { GameEvent } from '../engine';
import { applyMatch, botMatch, forfeitMatch, maskMatch, maskMatchEvents, matchResult, setupMatch, timeoutMatch, type MatchStep } from './match';
import type { MatchState } from './state';
import type { Logic } from './types';
import { isSeat } from './validate';

export type { BotLevel, ConcedeAction, EndReason, LogEntry, MatchAction, MatchResult, MatchState, Snapshot } from './state';
export type { Logic, SetupContext, Step } from './types';

installDefaultPool();

const MODULE_ERROR: MatchStep = { ok: false, reason: 'module_error' };
const BAD_SEAT: MatchStep = { ok: false, reason: 'bad seat' };

function guard<T>(fallback: T, run: () => T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

export const logic = {
  setup: (ctx) => guard(MODULE_ERROR, () => setupMatch(ctx)),
  apply: (state, seat, action) => guard(MODULE_ERROR, () => (isSeat(seat) ? applyMatch(state, seat, action) : BAD_SEAT)),
  mask: (state, seat) => guard(null, () => (isSeat(seat) ? maskMatch(state, seat) : null)),
  maskEvents: (events, seat) => guard([], () => (isSeat(seat) ? maskMatchEvents(events, seat) : [])),
  onTimeout: (state, seat) => guard(MODULE_ERROR, () => (isSeat(seat) ? timeoutMatch(state, seat) : BAD_SEAT)),
  forfeit: (state, seat, reason) => guard(MODULE_ERROR, () => (isSeat(seat) ? forfeitMatch(state, seat, reason) : BAD_SEAT)),
  result: (state) => guard(null, () => matchResult(state)),
  bot: (state, seat) => guard(null, () => (isSeat(seat) ? botMatch(state, seat) : null)),
} satisfies Logic<MatchState, GameEvent>;
