// 开局和换牌（spec 2.2、6.5）。
import type { Action } from './actions';
import { findCard, getHeroClass } from './cardDb';
import { emit, GameOverSignal, makeCtx, newGroup, type Ctx } from './context';
import type { GameEvent } from './events';
import { nextInt, seedRng, shuffle } from './rng';
import {
  HERO_HEALTH,
  MANA_POTION_ID,
  type CardInstance,
  type GameState,
  type HeroClass,
  type PlayerState,
  type Side,
} from './state';
import { startTurn } from './turn';

export type CreateGameOptions = {
  seed: number;
  classes: [HeroClass, HeroClass];
  decks: [string[], string[]]; // 卡牌 id 列表。30 张、同名最多 2 张的组卡规则由 validateDeck 检查，这里不强制
  first?: Side; // 指定先手，测试用；不指定时随机
  skipMulligan?: boolean; // 跳过换牌，测试和命令行对局用
};

// 创建对局。卡组里有不存在的卡或衍生物时抛错（这是调用方的编程错误，不是玩家的非法动作）。
export function createGame(opts: CreateGameOptions): { state: GameState; events: GameEvent[] } {
  let rng = seedRng(opts.seed);
  let first: Side;
  if (opts.first !== undefined) first = opts.first;
  else {
    let r: number;
    [r, rng] = nextInt(rng, 2);
    first = r as Side;
  }
  let nextInstanceId = 1;
  const players = ([0, 1] as const).map((side): PlayerState => {
    getHeroClass(opts.classes[side]);
    for (const id of opts.decks[side]) {
      const def = findCard(id);
      if (!def) throw new Error(`unknown card in deck: ${id}`);
      if (def.token || def.type === 'hero_power') throw new Error(`card cannot be in a deck: ${id}`);
    }
    let ids: string[];
    [ids, rng] = shuffle(rng, opts.decks[side]);
    // 实例 id 按洗牌后的顺序分配，id 不泄露卡组列表的顺序
    const deck: CardInstance[] = ids.map((cardId) => ({ instanceId: nextInstanceId++, cardId }));
    return {
      heroClass: opts.classes[side],
      hero: { health: HERO_HEALTH, maxHealth: HERO_HEALTH },
      mana: { max: 0, current: 0, temp: 0 },
      deck,
      hand: [],
      board: [],
      fatigue: 0,
      heroPowerUsed: false,
      cardsPlayedThisTurn: 0,
      mulliganDone: false,
    };
  }) as [PlayerState, PlayerState];

  const state: GameState = {
    phase: 'mulligan',
    turn: 0,
    current: first,
    players,
    rng,
    nextInstanceId,
    nextSummonOrder: 1,
  };
  // 起手：先手 3 张，后手 4 张加一张法力药水
  const second: Side = first === 0 ? 1 : 0;
  for (const side of [0, 1] as const) {
    const p = state.players[side];
    const n = side === first ? 3 : 4;
    p.hand = p.deck.slice(0, n);
    p.deck = p.deck.slice(n);
  }
  state.players[second].hand.push({ instanceId: state.nextInstanceId++, cardId: MANA_POTION_ID });

  const ctx = makeCtx(state);
  emit(ctx, newGroup(ctx), {
    kind: 'mulligan_start',
    first,
    hands: [[...state.players[0].hand], [...state.players[1].hand]],
  });
  if (opts.skipMulligan) {
    for (const p of state.players) {
      p.mulliganDone = true;
      p.mulliganReplace = [];
    }
    finishMulligan(ctx);
  }
  return { state: ctx.state, events: ctx.events };
}

// 一方提交换牌。双方都提交后才执行，固定按 0、1 的顺序，所以提交顺序不影响结果。
export function submitMulligan(ctx: Ctx, action: Extract<Action, { kind: 'mulligan' }>): void {
  const p = ctx.state.players[action.player];
  p.mulliganDone = true;
  p.mulliganReplace = [...action.replace];
  if (ctx.state.players.every((x) => x.mulliganDone)) finishMulligan(ctx);
}

// 把换掉的牌洗回牌库、补抽同样张数（新牌放回原来的位置），然后开始先手的第一回合。
function finishMulligan(ctx: Ctx): void {
  const state = ctx.state;
  for (const side of [0, 1] as const) {
    const p = state.players[side];
    const replace = p.mulliganReplace ?? [];
    const replaced = replace.map((i) => p.hand[i]);
    let deck = p.deck;
    if (replaced.length > 0) [deck, state.rng] = shuffle(state.rng, [...p.deck, ...replaced]);
    const drawn = deck.slice(0, replaced.length);
    p.deck = deck.slice(replaced.length);
    const hand = [...p.hand];
    replace.forEach((handIndex, k) => {
      hand[handIndex] = drawn[k];
    });
    p.hand = hand;
    delete p.mulliganReplace;
    emit(ctx, newGroup(ctx), { kind: 'mulligan_done', side, replaced, drawn });
  }
  state.phase = 'playing';
  emit(ctx, newGroup(ctx), { kind: 'game_start', first: state.current });
  try {
    startTurn(ctx, state.current, 1);
  } catch (e) {
    if (!(e instanceof GameOverSignal)) throw e;
  }
}
