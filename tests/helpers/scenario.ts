// 场景 DSL（spec 6.7）：直接搭一个对局中的局面，然后执行动作、断言结果和事件。
//   const g = scenario().board(0, ['卡特琳娜']).board(1, ['近战小兵', '石甲虫']).hand(0, ['审判']).build();
//   g.play('审判');
//   expect(g.p(1).board).toHaveLength(0);
import { expect } from 'vitest';
import {
  allCards,
  applyAction,
  listLegalActions,
  seedRng,
  type Action,
  type ApplyResult,
  type CardDef,
  type EventOf,
  type GameEvent,
  type GameEventKind,
  type GameState,
  type HeroClass,
  type Keyword,
  type MinionState,
  type PlayerState,
  type Side,
  type TargetRef,
} from '../../src/engine';

export function cardByName(nameOrId: string): CardDef {
  const def = allCards().find((c) => c.name === nameOrId || c.id === nameOrId);
  if (!def) throw new Error(`no card named ${nameOrId}`);
  return def;
}

export type MinionSpec =
  | string
  | {
      card: string;
      attack?: number;
      health?: number;
      maxHealth?: number;
      keywords?: Keyword[];
      enteredTurn?: number; // 默认上一回合，即没有召唤失调
      frozenAt?: number;
      silenced?: boolean;
      attacksThisTurn?: number;
    };

type PlayerSpec = {
  heroClass: HeroClass;
  health: number;
  mana: number;
  maxMana?: number;
  hand: string[];
  deck: string[];
  board: { spec: MinionSpec; order: number }[];
  fatigue: number;
  cardsPlayedThisTurn: number;
};

const FILLER = 'neutral.melee_minion';

export class ScenarioBuilder {
  private players: [PlayerSpec, PlayerSpec] = [0, 1].map(() => ({
    heroClass: 'demacia' as HeroClass,
    health: 30,
    mana: 10,
    hand: [],
    deck: Array(10).fill(FILLER),
    board: [],
    fatigue: 0,
    cardsPlayedThisTurn: 0,
  })) as unknown as [PlayerSpec, PlayerSpec];
  private turnNo = 5;
  private currentSide: Side = 0;
  private seedValue = 1;
  private order = 0;

  classes(a: HeroClass, b: HeroClass): this {
    this.players[0].heroClass = a;
    this.players[1].heroClass = b;
    return this;
  }
  board(side: Side, minions: MinionSpec[]): this {
    for (const spec of minions) this.players[side].board.push({ spec, order: this.order++ });
    return this;
  }
  hand(side: Side, cards: string[]): this {
    this.players[side].hand.push(...cards);
    return this;
  }
  deck(side: Side, cards: string[]): this {
    this.players[side].deck = [...cards];
    return this;
  }
  mana(side: Side, current: number, max = Math.max(current, this.players[side].maxMana ?? 0)): this {
    this.players[side].mana = current;
    this.players[side].maxMana = max;
    return this;
  }
  health(side: Side, hp: number): this {
    this.players[side].health = hp;
    return this;
  }
  fatigue(side: Side, n: number): this {
    this.players[side].fatigue = n;
    return this;
  }
  cardsPlayed(side: Side, n: number): this {
    this.players[side].cardsPlayedThisTurn = n;
    return this;
  }
  turn(n: number, current: Side = this.currentSide): this {
    this.turnNo = n;
    this.currentSide = current;
    return this;
  }
  current(side: Side): this {
    this.currentSide = side;
    return this;
  }
  seed(n: number): this {
    this.seedValue = n;
    return this;
  }

  build(): Game {
    let nextId = 1;
    const turn = this.turnNo;
    const placed: { side: Side; m: MinionState; order: number }[] = [];
    const players = this.players.map((ps, side): PlayerState => {
      const card = (name: string) => ({ instanceId: nextId++, cardId: cardByName(name).id });
      const board = ps.board.map(({ spec, order }) => {
        const s = typeof spec === 'string' ? { card: spec } : spec;
        const def = cardByName(s.card);
        if (def.type !== 'minion') throw new Error(`${s.card} is not a minion`);
        const maxHealth = s.maxHealth ?? s.health ?? def.health!;
        const m: MinionState = {
          instanceId: nextId++,
          cardId: def.id,
          attack: s.attack ?? def.attack!,
          health: s.health ?? maxHealth,
          maxHealth,
          buffs: [],
          keywords: [...(s.keywords ?? def.keywords ?? [])],
          attacksThisTurn: s.attacksThisTurn ?? 0,
          enteredTurn: s.enteredTurn ?? turn - 1,
          silenced: s.silenced ?? false,
          summonOrder: 0,
          extraAttacks: 0,
        };
        if (s.frozenAt !== undefined) m.frozenAt = s.frozenAt;
        placed.push({ side: side as Side, m, order });
        return m;
      });
      const maxMana = ps.maxMana ?? ps.mana;
      return {
        heroClass: ps.heroClass,
        hero: { health: ps.health, maxHealth: 30 },
        mana: { max: Math.min(10, maxMana), current: ps.mana, temp: 0 },
        deck: ps.deck.map(card),
        hand: ps.hand.map(card),
        board,
        fatigue: ps.fatigue,
        heroPowerUsed: false,
        cardsPlayedThisTurn: ps.cardsPlayedThisTurn,
        mulliganDone: true,
      };
    }) as [PlayerState, PlayerState];
    placed.sort((a, b) => a.order - b.order).forEach((p, i) => (p.m.summonOrder = i + 1));
    const state: GameState = {
      phase: 'playing',
      turn,
      current: this.currentSide,
      players,
      rng: seedRng(this.seedValue),
      nextInstanceId: nextId,
      nextSummonOrder: placed.length + 1,
    };
    return new Game(state);
  }
}

export function scenario(): ScenarioBuilder {
  return new ScenarioBuilder();
}

export class Game {
  events: GameEvent[] = [];
  log: GameEvent[] = [];
  constructor(public state: GameState) {}

  // 执行动作，非法时让测试失败。
  apply(action: Action): this {
    const r = applyAction(this.state, action);
    if (!r.ok) throw new Error(`action rejected: ${r.error} (${JSON.stringify(action)})`);
    this.state = r.state;
    this.events = r.events;
    this.log.push(...r.events);
    return this;
  }

  // 执行动作，返回结果，不改 Game（用来断言非法动作）。
  try(action: Action): ApplyResult {
    return applyAction(this.state, action);
  }

  p(side: Side): PlayerState {
    return this.state.players[side];
  }

  handIndex(name: string, side: Side = this.state.current): number {
    const id = cardByName(name).id;
    const i = this.p(side).hand.findIndex((c) => c.cardId === id);
    if (i < 0) throw new Error(`${name} not in hand of ${side}`);
    return i;
  }

  playAction(name: string, opts: { pos?: number; target?: TargetRef } = {}): Action {
    const handIndex = this.handIndex(name);
    const def = cardByName(name);
    const action: Action = { kind: 'play_card', handIndex };
    if (def.type === 'minion') action.position = opts.pos ?? this.p(this.state.current).board.length;
    if (opts.target) action.target = opts.target;
    return action;
  }

  play(name: string, opts: { pos?: number; target?: TargetRef } = {}): this {
    return this.apply(this.playAction(name, opts));
  }

  attack(attacker: TargetRef, target: TargetRef): this {
    return this.apply({ kind: 'attack', attacker, target });
  }

  heroPower(target?: TargetRef): this {
    return this.apply(target ? { kind: 'hero_power', target } : { kind: 'hero_power' });
  }

  endTurn(): this {
    return this.apply({ kind: 'end_turn' });
  }

  // 第 nth 个叫这个名字的随从。
  minion(side: Side, name: string, nth = 0): MinionState {
    const id = cardByName(name).id;
    const list = this.p(side).board.filter((m) => m.cardId === id);
    if (!list[nth]) throw new Error(`no ${name} #${nth} on board ${side}`);
    return list[nth];
  }

  has(side: Side, name: string): boolean {
    const id = cardByName(name).id;
    return this.p(side).board.some((m) => m.cardId === id);
  }

  m(side: Side, name: string, nth = 0): TargetRef {
    return { side, kind: 'minion', instanceId: this.minion(side, name, nth).instanceId };
  }

  hero(side: Side): TargetRef {
    return { side, kind: 'hero' };
  }

  boardNames(side: Side): string[] {
    return this.p(side).board.map((m) => allCards().find((c) => c.id === m.cardId)!.name);
  }

  legal(side: Side = this.state.current): Action[] {
    return listLegalActions(this.state, side);
  }

  eventsOf<K extends GameEventKind>(kind: K, from: GameEvent[] = this.events): EventOf<K>[] {
    return from.filter((e): e is EventOf<K> => e.kind === kind);
  }

  kinds(from: GameEvent[] = this.events): GameEventKind[] {
    return from.map((e) => e.kind);
  }
}

// 断言动作非法。
export function expectIllegal(r: ApplyResult): void {
  expect(r.ok).toBe(false);
}
