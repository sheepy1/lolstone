// 对局场景：按显示局面渲染棋盘上的一切（spec 5.8 "Pixi 场景按显示局面渲染"）。
// sync(view) 把场景对到显示局面：缺的显示对象建出来，多的移走，每个对象滑到布局给出的槽位，数值刷新。
// 动画模块在 sync 前后加自己的表现；手牌和随从以实例 id 为键，同一个对象从牌库一路跟到手牌、场上。
import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';
import { findCard, other, type Side, type TargetRef } from '../engine';
import type { Point } from '../presentation/fx/arrow';
import { TargetArrow } from '../presentation/fx/arrow';
import {
  boardSlot,
  deckSlot,
  endTurnSlot,
  handHoverSlot,
  handNeighborShift,
  handSlot,
  heroPowerSlot,
  heroSlot,
  manaSlot,
  mulliganSlot,
  placementOf,
  STAGE_H,
  STAGE_W,
  type Placement,
  type Slot,
} from '../presentation/layout';
import type { ViewState } from '../presentation/viewState';
import { CardView } from './cardView';
import { HeroPowerView, HeroView } from './heroView';
import { MinionView } from './minionView';
import { BoardView, DeckView, EndTurnButton, ManaBarView, ThinkingView } from './tableParts';
import { fadeOutAndDispose } from './dispose';

export type LegalHighlights = {
  playable: Set<number>; // 能打出的手牌实例 id
  attackers: Set<number>; // 能攻击的随从实例 id
  heroPower: boolean;
  endTurnReady: boolean; // 除了结束回合没有别的事可做
};

export type TargetMarks = { targets: TargetRef[] } | null;

const LAYOUT_DURATION = 0.3;

export class TableScene {
  readonly root = new Container();
  readonly layers = {
    board: new Container(),
    heroes: new Container(),
    minions: new Container(),
    handFar: new Container(),
    handNear: new Container(),
    fx: new Container(),
    drag: new Container(),
    top: new Container(),
  };
  readonly arrow = new TargetArrow();
  readonly heroes: [HeroView, HeroView];
  readonly heroPowers: [HeroPowerView, HeroPowerView];
  readonly decks: [DeckView, DeckView] = [new DeckView(), new DeckView()];
  readonly mana: [ManaBarView, ManaBarView] = [new ManaBarView(), new ManaBarView()];
  readonly endTurn: EndTurnButton;
  readonly thinking = new ThinkingView();
  // 换牌阶段压暗棋盘，让起手牌突出
  private shade = new Graphics().rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0x000000, alpha: 0.55 });
  readonly handCards = new Map<number, CardView>();
  readonly minions = new Map<number, MinionView>();
  view: ViewState;

  // 交互状态，布局时要考虑
  hoveredHand: number | null = null;
  draggingHand: number | null = null;
  boardGap: number | null = null; // 我方随从行空出的位置
  mulliganMarks = new Set<number>();
  // 新手牌的出发点（默认从牌库飞出；回手的牌从随从原来的位置飞出）
  readonly handSpawn = new Map<number, Point>();
  // 随从最后所在的位置，离场后的事件（亡语）用它定位
  private lastMinionPos = new Map<number, Point>();
  private highlights: LegalHighlights | null = null;
  private targetMarks: TargetMarks = null;

  constructor(view: ViewState, onEndTurn: () => void) {
    this.view = view;
    const v = view.viewer;
    this.heroes = [new HeroView(view.players[0].heroClass, v !== 0), new HeroView(view.players[1].heroClass, v !== 1)];
    this.heroPowers = [new HeroPowerView(view.players[0].heroClass), new HeroPowerView(view.players[1].heroClass)];
    this.endTurn = new EndTurnButton(onEndTurn);
    const L = this.layers;
    L.board.addChild(new BoardView());
    for (const side of [0, 1] as Side[]) {
      const p = this.place(side);
      put(this.heroes[side], heroSlot(p));
      put(this.heroPowers[side], heroPowerSlot(p));
      put(this.decks[side], deckSlot(p));
      this.decks[side].scale.set(1);
      put(this.mana[side], manaSlot(p));
      L.heroes.addChild(this.heroes[side], this.heroPowers[side], this.decks[side], this.mana[side]);
    }
    put(this.endTurn, endTurnSlot());
    const far = heroSlot('far');
    this.thinking.position.set(far.x - 230, far.y);
    L.heroes.addChild(this.endTurn, this.thinking);
    L.top.addChild(this.arrow);
    this.shade.eventMode = 'none';
    this.root.addChild(L.board, L.heroes, L.minions, L.handFar, L.fx, this.shade, L.handNear, L.drag, L.top);
    this.sync(view, 0);
  }

  place(side: Side): Placement {
    return placementOf(side, this.view.viewer);
  }

  // ---------- 查询 ----------

  minion(id: number): MinionView | undefined {
    return this.minions.get(id);
  }

  // 一个目标当前在画面上的位置。
  pointOf(ref: TargetRef): Point {
    if (ref.kind === 'hero') return { x: this.heroes[ref.side].x, y: this.heroes[ref.side].y };
    const m = this.minions.get(ref.instanceId);
    if (m) return { x: m.x + m.body.x, y: m.y + m.body.y };
    const last = this.lastMinionPos.get(ref.instanceId);
    if (last) return last;
    // 没见过：落在那一方随从行中央
    return { x: 960, y: boardSlot(this.place(ref.side), 0, 1).y };
  }

  deckPoint(side: Side): Point {
    const s = deckSlot(this.place(side));
    return { x: s.x, y: s.y };
  }

  heroPowerPoint(side: Side): Point {
    const s = heroPowerSlot(this.place(side));
    return { x: s.x, y: s.y };
  }

  // 一个目标对应的显示对象（动画模块拿来抖动、闪光）。
  targetBody(ref: TargetRef): { body: Container; flash: Container } | null {
    if (ref.kind === 'hero') return this.heroes[ref.side];
    return this.minions.get(ref.instanceId) ?? null;
  }

  // 动画模块接管一张手牌（比如打出的牌飞到中央），之后 sync 不再管它，用完由接管方销毁。
  takeHandCard(id: number): CardView | null {
    const c = this.handCards.get(id);
    if (!c) return null;
    this.handCards.delete(id);
    const pos = c.getGlobalPosition();
    const local = this.layers.drag.toLocal(pos);
    this.layers.drag.addChild(c);
    c.position.copyFrom(local);
    return c;
  }

  // 新建一张不在手牌里的牌（爆牌、对手出牌的展示）。
  makeCard(instanceId: number, cardId: string, at: Slot): CardView {
    const c = new CardView(instanceId, cardId);
    put(c, at);
    this.layers.drag.addChild(c);
    return c;
  }

  // ---------- 同步 ----------

  // 把场景对到显示局面。duration 为 0 时直接跳到位。返回有没有对象需要移动。
  sync(view: ViewState, duration = LAYOUT_DURATION): boolean {
    this.view = view;
    this.shade.visible = view.phase === 'mulligan';
    let moved = false;
    for (const side of [0, 1] as Side[]) {
      const p = view.players[side];
      this.heroes[side].setHealth(p.hero.health, p.hero.maxHealth);
      this.heroPowers[side].setUsed(p.heroPowerUsed);
      this.decks[side].set(p.deckCount, p.fatigue);
      this.mana[side].set(p.mana);
      moved = this.syncHand(side, duration) || moved;
      moved = this.syncBoard(side, duration) || moved;
    }
    this.endTurn.setMode(this.endTurnMode(), this.highlights?.endTurnReady ?? false);
    this.applyHighlights();
    return moved;
  }

  private endTurnMode(): 'mine' | 'theirs' | 'off' {
    const v = this.view;
    if (v.phase !== 'playing') return 'off';
    return v.current === v.viewer ? 'mine' : 'theirs';
  }

  // 只重排手牌（悬停、拖拽时用）。
  layoutHand(duration = 0.15): void {
    for (const side of [0, 1] as Side[]) this.syncHand(side, duration);
  }

  // 只重排我方随从行（拖随从牌时空出位置）。
  layoutBoard(duration = 0.15): void {
    this.syncBoard(this.view.viewer, duration);
  }

  private syncHand(side: Side, duration: number): boolean {
    const p = this.place(side);
    const hand = this.view.players[side].hand;
    const ids = new Set(hand.map((c) => c.instanceId));
    let moved = false;
    for (const [id, c] of this.handCards) {
      if (ids.has(id) || c.parent !== this.layerOf(p)) continue;
      this.handCards.delete(id);
      fadeOutAndDispose(c);
    }
    const mulligan = this.view.phase === 'mulligan' && p === 'near';
    const visible = hand.filter((c) => c.instanceId !== this.draggingHand);
    const hoveredIndex = visible.findIndex((c) => c.instanceId === this.hoveredHand);
    visible.forEach((card, i) => {
      let c = this.handCards.get(card.instanceId);
      if (!c) {
        c = new CardView(card.instanceId, card.cardId);
        const from = this.handSpawn.get(card.instanceId);
        this.handSpawn.delete(card.instanceId);
        put(c, from ? { ...deckSlot(p), ...from } : deckSlot(p));
        this.handCards.set(card.instanceId, c);
        this.layerOf(p).addChild(c);
      }
      c.setCard(card.cardId);
      c.setMarked(mulligan && this.mulliganMarks.has(card.instanceId));
      let slot: Slot;
      if (mulligan) slot = mulliganSlot(i, visible.length);
      else if (p === 'near' && hoveredIndex >= 0) {
        slot = i === hoveredIndex ? handHoverSlot(i, visible.length) : handSlot(p, i, visible.length);
        if (i !== hoveredIndex) slot = { ...slot, x: slot.x + handNeighborShift(i, hoveredIndex) };
      } else slot = handSlot(p, i, visible.length);
      // 悬停的牌放到最上层
      c.zIndex = i === hoveredIndex ? 100 : i;
      moved = moveTo(c, slot, duration) || moved;
    });
    this.layerOf(p).sortableChildren = true;
    return moved;
  }

  private syncBoard(side: Side, duration: number): boolean {
    const p = this.place(side);
    const board = this.view.players[side].board;
    const ids = new Set(board.map((m) => m.instanceId));
    let moved = false;
    for (const [id, m] of this.minions) {
      if (m.side !== side || ids.has(id)) continue;
      this.minions.delete(id);
      this.lastMinionPos.set(id, { x: m.x, y: m.y });
      fadeOutAndDispose(m);
    }
    const gap = p === 'near' ? this.boardGap : null;
    board.forEach((vm, i) => {
      let m = this.minions.get(vm.instanceId);
      const slot = boardSlot(p, i, board.length, gap);
      if (!m) {
        m = new MinionView(vm, side);
        put(m, slot);
        this.minions.set(vm.instanceId, m);
        this.layers.minions.addChild(m);
        if (duration > 0) {
          m.body.scale.set(0.2);
          gsap.to(m.body.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.5)' });
          moved = true;
        }
      }
      m.update(vm);
      moved = moveTo(m, slot, duration) || moved;
    });
    return moved;
  }

  private layerOf(p: Placement): Container {
    return p === 'near' ? this.layers.handNear : this.layers.handFar;
  }

  // ---------- 高亮 ----------

  // 合法操作的高亮。null 表示输入锁定，全部熄灭。
  setHighlights(h: LegalHighlights | null): void {
    this.highlights = h;
    this.endTurn.setMode(this.endTurnMode(), h?.endTurnReady ?? false);
    this.applyHighlights();
  }

  // 选目标时：合法目标红色准星高亮，其余变暗。null 表示退出选目标。
  setTargetMarks(marks: TargetMarks): void {
    this.targetMarks = marks;
    this.applyHighlights();
  }

  private applyHighlights(): void {
    const h = this.highlights;
    const v = this.view;
    const me = v.viewer;
    const mana = v.players[me].mana.current;
    for (const c of this.handCards.values()) {
      const mine = c.parent === this.layers.handNear;
      if (!mine || c.hidden) continue;
      c.setHighlight(!!h && h.playable.has(c.instanceId) && !this.targetMarks);
      const cost = cardCost(c.cardId);
      c.setDim(v.phase === 'playing' && cost > mana);
    }
    const marks = this.targetMarks;
    const isMarked = (ref: TargetRef) =>
      !!marks && marks.targets.some((t) => t.side === ref.side && t.kind === ref.kind && (t.kind === 'hero' || (ref.kind === 'minion' && t.instanceId === ref.instanceId)));
    for (const m of this.minions.values()) {
      const ref: TargetRef = { side: m.side, kind: 'minion', instanceId: m.instanceId };
      if (marks) m.setHighlight(isMarked(ref) ? 'target' : 'dim');
      else m.setHighlight(h && m.side === me && h.attackers.has(m.instanceId) ? 'attack' : 'none');
      m.setSleepy(!marks && !!h && m.side === me && !h.attackers.has(m.instanceId) && v.current === me);
    }
    for (const side of [0, 1] as Side[]) {
      const ref: TargetRef = { side, kind: 'hero' };
      this.heroes[side].setTargetable(marks ? (isMarked(ref) ? 'target' : 'dim') : 'none');
    }
    this.heroPowers[me].setUsable(!!h && h.heroPower && !marks);
    this.heroPowers[other(me)].setUsable(false);
  }
}

function cardCost(cardId: string): number {
  return findCard(cardId)?.cost ?? 0;
}

function put(obj: Container, s: Slot): void {
  obj.position.set(s.x, s.y);
  obj.rotation = s.rotation;
  obj.scale.set(s.scale);
}

// 滑到槽位。返回是否需要移动。
function moveTo(obj: Container, s: Slot, duration: number): boolean {
  const far = Math.abs(obj.x - s.x) > 0.5 || Math.abs(obj.y - s.y) > 0.5 || Math.abs(obj.scale.x - s.scale) > 0.01 || Math.abs(obj.rotation - s.rotation) > 0.01;
  if (!far) return false;
  if (duration <= 0) {
    gsap.killTweensOf(obj);
    gsap.killTweensOf(obj.scale);
    put(obj, s);
    return true;
  }
  gsap.to(obj, { x: s.x, y: s.y, rotation: s.rotation, duration, ease: 'power2.out', overwrite: 'auto' });
  gsap.to(obj.scale, { x: s.scale, y: s.scale, duration, ease: 'power2.out', overwrite: 'auto' });
  return true;
}
