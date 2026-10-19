// AI 的统一接口：给一个局面和一方，返回这一方的下一个动作。不是这一方行动时返回 null。
// rng 是 AI 自己的随机数流（L0 用来随机选，L1 原样返回），不是对局局面里的随机数。
import type { Action } from '../engine/actions';
import type { GameState, RngState, Side } from '../engine/state';

export type AiChoice = { action: Action; rng: RngState };
export type ChooseAction = (state: GameState, side: Side, rng: RngState) => AiChoice | null;
