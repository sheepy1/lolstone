// AI 对 AI 的自动对局：冒烟测试、命令行 --auto 和 arena 统计用。两边可以是任意 AI（L0、L1）。
import { applyAction } from '../engine/game';
import type { GameEvent } from '../engine/events';
import { maskHidden } from '../engine/mask';
import { seedRng } from '../engine/rng';
import { createGame } from '../engine/setup';
import type { GameState, HeroClass, RngState, Side } from '../engine/state';
import { l0ChooseAction } from './l0';
import type { ChooseAction } from './types';

export type SelfPlayResult = {
  seed: number;
  winner: Side | 'draw';
  turns: number;
  actions: number;
  state: GameState;
};

export type SelfPlayOptions = {
  seed: number;
  classes: [HeroClass, HeroClass];
  decks: [string[], string[]];
  maxActions?: number; // 超过这么多步还没结束就当卡死报错
  onEvents?: (events: GameEvent[], state: GameState) => void;
};

export type GameOptions = SelfPlayOptions & {
  ais: [ChooseAction, ChooseAction];
};

// 每一方的 AI 只拿到自己那一方能看到的局面（maskHidden），选出的动作在真实局面上执行。
export function playGame(opts: GameOptions): SelfPlayResult {
  const maxActions = opts.maxActions ?? 20_000;
  const created = createGame({ seed: opts.seed, classes: opts.classes, decks: opts.decks });
  let state = created.state;
  opts.onEvents?.(created.events, state);
  const rngs: [RngState, RngState] = [seedRng(opts.seed * 2 + 1), seedRng(opts.seed * 2 + 2)];
  let actions = 0;
  while (state.phase !== 'over') {
    if (actions >= maxActions) throw new Error(`seed ${opts.seed}: game did not finish in ${maxActions} actions`);
    // 换牌阶段双方都能行动，固定先让还没提交的一方走
    const side: Side = state.phase === 'mulligan' ? (state.players[0].mulliganDone ? 1 : 0) : state.current;
    const choice = opts.ais[side](maskHidden(state, side), side, rngs[side]);
    if (!choice) throw new Error(`seed ${opts.seed}: no legal action for player ${side}`);
    rngs[side] = choice.rng;
    const result = applyAction(state, choice.action);
    if (!result.ok) throw new Error(`seed ${opts.seed}: action rejected for player ${side}: ${result.error}`);
    state = result.state;
    opts.onEvents?.(result.events, state);
    actions += 1;
  }
  return { seed: opts.seed, winner: state.winner!, turns: state.turn, actions, state };
}

export function playL0Game(opts: SelfPlayOptions): SelfPlayResult {
  return playGame({ ...opts, ais: [l0ChooseAction, l0ChooseAction] });
}
