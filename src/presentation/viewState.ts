// 显示局面（spec 5.8）。玩家看到的永远是它：它只靠事件推进，落后于真实局面，动画播完才追上。
// 推进规则只读事件和静态卡牌数据（关键词、卡面数值），不反查引擎局面。
import {
  getCard,
  maskHidden,
  type CardInstance,
  type GameState,
  type HeroClass,
  type Keyword,
  type ManaSnapshot,
  type Side,
  type TargetRef,
} from '../engine';
import type { PresentationEvent } from './events';

export type ViewCard = CardInstance; // cardId 为 hidden 时是看不到的牌

export type ViewMinion = {
  instanceId: number;
  cardId: string;
  attack: number;
  health: number;
  maxHealth: number;
  keywords: Keyword[];
  frozen: boolean;
  silenced: boolean;
};

export type ViewPlayer = {
  heroClass: HeroClass;
  hero: { health: number; maxHealth: number };
  mana: ManaSnapshot;
  deckCount: number;
  hand: ViewCard[];
  board: ViewMinion[];
  fatigue: number;
  heroPowerUsed: boolean;
  mulliganDone: boolean;
};

export type ViewState = {
  viewer: Side;
  phase: 'mulligan' | 'playing' | 'over';
  turn: number;
  current: Side;
  players: [ViewPlayer, ViewPlayer];
  winner: Side | 'draw' | null;
};

// 真实局面在 viewer 眼里的样子（先 maskHidden）。测试用它核对显示局面追上之后和真实局面一致。
export function viewFromState(state: GameState, viewer: Side): ViewState {
  const s = maskHidden(state, viewer);
  return {
    viewer,
    phase: s.phase,
    turn: s.turn,
    current: s.current,
    winner: s.winner ?? null,
    players: [0, 1].map((side) => {
      const p = s.players[side];
      return {
        heroClass: p.heroClass,
        hero: { ...p.hero },
        mana: { ...p.mana },
        deckCount: p.deck.length,
        hand: p.hand.map((c) => ({ ...c })),
        board: p.board.map((m) => ({
          instanceId: m.instanceId,
          cardId: m.cardId,
          attack: m.attack,
          health: m.health,
          maxHealth: m.maxHealth,
          keywords: [...m.keywords],
          frozen: m.frozenAt !== undefined,
          silenced: m.silenced,
        })),
        fatigue: p.fatigue,
        heroPowerUsed: p.heroPowerUsed,
        mulliganDone: p.mulliganDone,
      };
    }) as [ViewPlayer, ViewPlayer],
  };
}

// 开局时的显示局面：createGame 之后的局面去掉手牌，起手由 mulligan_start 事件发到手里。
export function initialView(state: GameState, viewer: Side): ViewState {
  const v = viewFromState(state, viewer);
  for (const p of v.players) p.hand = [];
  return v;
}

function freshMinion(instanceId: number, cardId: string, attack: number, health: number): ViewMinion {
  return {
    instanceId,
    cardId,
    attack,
    health,
    maxHealth: health,
    keywords: [...(getCard(cardId).keywords ?? [])],
    frozen: false,
    silenced: false,
  };
}

export function findMinion(view: ViewState, ref: TargetRef): ViewMinion | undefined {
  if (ref.kind !== 'minion') return undefined;
  return view.players[ref.side].board.find((m) => m.instanceId === ref.instanceId);
}

function removeMinion(p: ViewPlayer, instanceId: number): void {
  p.board = p.board.filter((m) => m.instanceId !== instanceId);
}

function setHealth(v: ViewState, ref: TargetRef, health: number): void {
  if (ref.kind === 'hero') v.players[ref.side].hero.health = health;
  else {
    const m = findMinion(v, ref);
    if (m) m.health = health;
  }
}

function dropKeywords(list: Keyword[], lost: readonly Keyword[]): Keyword[] {
  return list.filter((k) => !lost.includes(k));
}

// 推进一个事件，返回新的显示局面，不改入参。
export function reduceView(view: ViewState, e: PresentationEvent): ViewState {
  const v: ViewState = structuredClone(view);
  switch (e.kind) {
    case 'mulligan_start':
      v.phase = 'mulligan';
      v.current = e.first;
      v.players[0].hand = e.hands[0].map((c) => ({ ...c }));
      v.players[1].hand = e.hands[1].map((c) => ({ ...c }));
      break;
    case 'mulligan_done': {
      const p = v.players[e.side];
      // 新牌放回被换掉的位置（NOTES「换牌」）
      e.replaced.forEach((old, i) => {
        const at = p.hand.findIndex((c) => c.instanceId === old.instanceId);
        if (at >= 0 && e.drawn[i]) p.hand[at] = { ...e.drawn[i] };
      });
      p.mulliganDone = true;
      break;
    }
    case 'game_start':
      v.phase = 'playing';
      v.current = e.first;
      break;
    case 'turn_start':
      v.turn = e.turn;
      v.current = e.side;
      v.players[e.side].heroPowerUsed = false;
      break;
    case 'draw': {
      const p = v.players[e.side];
      p.hand.splice(e.handIndex, 0, { ...e.card });
      p.deckCount = Math.max(0, p.deckCount - 1);
      break;
    }
    case 'burn':
      v.players[e.side].deckCount = Math.max(0, v.players[e.side].deckCount - 1);
      break;
    case 'fatigue':
      v.players[e.side].fatigue = e.amount;
      break;
    case 'card_played': {
      const p = v.players[e.side];
      p.hand = p.hand.filter((c) => c.instanceId !== e.card.instanceId);
      break;
    }
    case 'minion_summoned': {
      if (e.target.kind !== 'minion') break;
      const p = v.players[e.side];
      p.board.splice(e.position, 0, freshMinion(e.target.instanceId, e.cardId, e.attack, e.health));
      break;
    }
    case 'hero_power_used':
      v.players[e.side].heroPowerUsed = true;
      break;
    case 'damage':
    case 'heal':
      setHealth(v, e.target, e.healthAfter);
      break;
    case 'death':
      if (e.target.kind === 'minion') removeMinion(v.players[e.target.side], e.target.instanceId);
      break;
    case 'buff': {
      const m = findMinion(v, e.target);
      if (!m) break;
      m.attack = e.attackAfter;
      m.health = e.healthAfter;
      m.maxHealth = e.maxHealthAfter;
      m.keywords = dropKeywords(m.keywords, e.keywordsLost);
      for (const k of e.keywords) if (!m.keywords.includes(k)) m.keywords.push(k);
      break;
    }
    case 'silence': {
      const m = findMinion(v, e.target);
      if (!m) break;
      m.attack = e.attackAfter;
      m.health = e.healthAfter;
      m.maxHealth = e.maxHealthAfter;
      m.keywords = [];
      m.frozen = false;
      m.silenced = true;
      break;
    }
    case 'freeze': {
      const m = findMinion(v, e.target);
      if (m) m.frozen = true;
      break;
    }
    case 'unfreeze': {
      const m = findMinion(v, e.target);
      if (m) m.frozen = false;
      break;
    }
    case 'shield_broken': {
      const m = findMinion(v, e.target);
      if (m) m.keywords = dropKeywords(m.keywords, ['divine_shield']);
      break;
    }
    case 'stealth_lost': {
      const m = findMinion(v, e.target);
      if (m) m.keywords = dropKeywords(m.keywords, ['stealth']);
      break;
    }
    case 'bounce': {
      if (e.target.kind !== 'minion') break;
      const p = v.players[e.target.side];
      removeMinion(p, e.target.instanceId);
      if (!e.destroyed && e.card && e.handIndex !== null) p.hand.splice(e.handIndex, 0, { ...e.card });
      break;
    }
    case 'transform': {
      if (e.target.kind !== 'minion' || e.newTarget.kind !== 'minion') break;
      const p = v.players[e.target.side];
      const at = p.board.findIndex((m) => m.instanceId === (e.target as { instanceId: number }).instanceId);
      const fresh = freshMinion(e.newTarget.instanceId, e.into, e.attack, e.health);
      if (at >= 0) p.board[at] = fresh;
      else p.board.splice(e.position, 0, fresh);
      break;
    }
    case 'mana_changed':
      v.players[e.side].mana = { ...e.after };
      break;
    case 'game_over':
      v.phase = 'over';
      v.winner = e.winner;
      break;
    case 'turn_end':
    case 'spell_cast':
    case 'trigger':
    case 'attack':
    case 'ai_thinking':
      break;
  }
  return v;
}
