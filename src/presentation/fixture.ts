// 回放夹具（spec 6.7）：录一局固定种子的 L0 对 L0 事件流。导演回放它，人工过一遍每种动画；
// 单元测试用它断言导演不漏事件、不乱序。事件按批记录（一批是一次 applyAction 的返回值），
// 存原始事件，回放时按 viewer 遮。
import { l0ChooseAction } from '../ai/l0';
import { applyAction, createGame, seedRng, type GameEvent, type HeroClass, type RngState, type Side } from '../engine';
import { initialView, type ViewState } from './viewState';

export type ReplayBatch = {
  actor: Side | null; // 这一批是谁的动作产生的；开局那批为 null
  events: GameEvent[];
};

export type ReplayFixture = {
  seed: number;
  classes: [HeroClass, HeroClass];
  viewer: Side;
  initialView: ViewState;
  batches: ReplayBatch[];
  winner: Side | 'draw';
  turns: number;
};

export function recordL0Game(seed: number, classes: [HeroClass, HeroClass], decks: [string[], string[]], viewer: Side = 0): ReplayFixture {
  const created = createGame({ seed, classes, decks });
  let state = created.state;
  const batches: ReplayBatch[] = [{ actor: null, events: created.events }];
  const rngs: [RngState, RngState] = [seedRng(seed * 2 + 1), seedRng(seed * 2 + 2)];
  let n = 0;
  while (state.phase !== 'over') {
    if (n++ > 20_000) throw new Error(`seed ${seed}: game did not finish`);
    const side: Side = state.phase === 'mulligan' ? (state.players[0].mulliganDone ? 1 : 0) : state.current;
    const choice = l0ChooseAction(state, side, rngs[side]);
    if (!choice) throw new Error(`seed ${seed}: no legal action`);
    rngs[side] = choice.rng;
    const r = applyAction(state, choice.action);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
    if (r.events.length > 0) batches.push({ actor: side, events: r.events });
  }
  return {
    seed,
    classes,
    viewer,
    initialView: initialView(created.state, viewer),
    batches,
    winner: state.winner!,
    turns: state.turn,
  };
}
