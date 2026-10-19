// 输入（spec 5.3、6.6）。能做什么只看宿主给的合法操作列表（来自真实局面的 listLegalActions），
// 这里不自己判断规则；宿主在显示局面追上真实局面之前、对方回合里返回 null，表示锁定。
// 锁定时仍然可以悬停看牌、快进动画。
import type { FederatedPointerEvent } from 'pixi.js';
import { Rectangle } from 'pixi.js';
import { actionKey, getCard, type Action, type TargetRef } from '../engine';
import type { Point } from '../presentation/fx/arrow';
import {
  BOARD_ROW_HALF,
  boardInsertIndex,
  boardRowY,
  boardSlot,
  CARD_H,
  CARD_W,
  castSlot,
  HAND_TOP_Y,
  STAGE_H,
  STAGE_W,
} from '../presentation/layout';
import type { CardView } from './cardView';
import type { TableScene } from './table';
import { COLORS } from './theme';

export type HoverInfo =
  | { kind: 'minion'; instanceId: number; side: 0 | 1 }
  | { kind: 'hand'; instanceId: number }
  | { kind: 'hero_power'; side: 0 | 1 };

export type InteractionHost = {
  legal(): Action[] | null; // null：输入锁定
  submit(action: Action): void;
  busy(): boolean; // 动画还在播
  fastForward(): void;
  hover(info: HoverInfo | null): void;
  mulliganChanged(marked: Set<number>): void;
  waiting(): boolean; // 对方行动中，鼠标显示等待
};

type Aim = {
  k: 'aim';
  from: Point;
  options: { target: TargetRef; action: Action }[];
  release: boolean; // 松手即提交（攻击、拖着的法术）；false 时点一下目标提交
  onCancel: () => void;
  spellCard?: { card: CardView; handIndex: number }; // 拖着的定向法术，拖回手牌区回到拖牌状态
};

type DragCard = { k: 'drag'; card: CardView; handIndex: number; minion: boolean; options: Action[] };

type Mode = { k: 'idle' } | DragCard | Aim;

const sameRef = (a: TargetRef, b: TargetRef) =>
  a.side === b.side && a.kind === b.kind && (a.kind === 'hero' || (b.kind === 'minion' && a.instanceId === b.instanceId));

export class Interaction {
  private mode: Mode = { k: 'idle' };
  private hovered: HoverInfo | null = null;
  private lastPointer: Point = { x: 0, y: 0 };

  constructor(
    private readonly scene: TableScene,
    private readonly host: InteractionHost,
  ) {
    const root = scene.root;
    root.eventMode = 'static';
    root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
    root.on('pointerdown', (e) => this.onDown(e));
    root.on('globalpointermove', (e) => this.onMove(e));
    root.on('pointerup', (e) => this.onUp(e));
    root.on('pointerupoutside', (e) => this.onUp(e));
    window.addEventListener('keydown', this.onKey);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
  }

  // 显示局面或合法操作变化后调用，刷新高亮。
  refresh(): void {
    const legal = this.host.legal();
    if (!legal && this.mode.k !== 'idle') this.cancel();
    this.scene.root.cursor = this.host.waiting() ? 'wait' : 'default';
    if (!legal || this.scene.view.phase !== 'playing') {
      this.scene.setHighlights(null);
      return;
    }
    const hand = this.scene.view.players[this.scene.view.viewer].hand;
    const playable = new Set<number>();
    const attackers = new Set<number>();
    let heroPower = false;
    for (const a of legal) {
      if (a.kind === 'play_card' && hand[a.handIndex]) playable.add(hand[a.handIndex].instanceId);
      if (a.kind === 'attack' && a.attacker.kind === 'minion') attackers.add(a.attacker.instanceId);
      if (a.kind === 'hero_power') heroPower = true;
    }
    this.scene.setHighlights({ playable, attackers, heroPower, endTurnReady: legal.length === 1 });
  }

  // ---------- 事件 ----------

  private local(e: FederatedPointerEvent): Point {
    const p = this.scene.root.toLocal(e.global);
    return { x: p.x, y: p.y };
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.host.busy()) this.host.fastForward();
    } else if (e.code === 'Escape') this.cancel();
  };

  private onDown(e: FederatedPointerEvent): void {
    const p = this.local(e);
    if (e.button === 2) {
      this.cancel();
      return;
    }
    if (e.button !== 0) return;
    if (this.host.busy()) {
      this.host.fastForward();
      return;
    }
    if (this.overEndTurn(p)) return; // 按钮自己处理
    const legal = this.host.legal();
    if (!legal) return;
    const view = this.scene.view;
    const me = view.viewer;

    if (this.mode.k === 'aim' && !this.mode.release) {
      const hit = this.targetAt(p);
      const opt = hit && this.mode.options.find((o) => sameRef(o.target, hit));
      if (opt) this.commit(opt.action);
      else this.cancel();
      return;
    }
    if (this.mode.k !== 'idle') return;

    if (view.phase === 'mulligan') {
      const card = this.handCardAt(p);
      if (!card || !legal.some((a) => a.kind === 'mulligan' && a.replace.includes(handIndexOf(view, card.instanceId)))) return;
      const marks = this.scene.mulliganMarks;
      if (marks.has(card.instanceId)) marks.delete(card.instanceId);
      else marks.add(card.instanceId);
      this.scene.layoutHand(0.1);
      this.host.mulliganChanged(new Set(marks));
      return;
    }

    const card = this.handCardAt(p);
    if (card) {
      const handIndex = handIndexOf(view, card.instanceId);
      const options = legal.filter((a) => a.kind === 'play_card' && a.handIndex === handIndex);
      if (options.length === 0) return;
      this.startDrag(card, handIndex, options, p);
      return;
    }

    const minion = this.minionAt(p);
    if (minion && minion.side === me) {
      const attacker: TargetRef = { side: me, kind: 'minion', instanceId: minion.instanceId };
      const options = legal
        .filter((a): a is Extract<Action, { kind: 'attack' }> => a.kind === 'attack' && sameRef(a.attacker, attacker))
        .map((a) => ({ target: a.target, action: a as Action }));
      if (options.length > 0) this.startAim({ from: this.scene.pointOf(attacker), options, release: true, onCancel: () => {} });
      return;
    }

    if (this.overHeroPower(p)) {
      const powers = legal.filter((a): a is Extract<Action, { kind: 'hero_power' }> => a.kind === 'hero_power');
      if (powers.length === 0) return;
      if (powers.length === 1 && !powers[0].target) this.commit(powers[0]);
      else {
        const options = powers.filter((a) => a.target).map((a) => ({ target: a.target!, action: a as Action }));
        this.startAim({ from: this.scene.heroPowerPoint(me), options, release: false, onCancel: () => {} });
      }
    }
  }

  private onMove(e: FederatedPointerEvent): void {
    const p = this.local(e);
    const dx = p.x - this.lastPointer.x;
    this.lastPointer = p;
    const m = this.mode;
    if (m.k === 'drag') {
      m.card.position.set(p.x, p.y);
      m.card.rotation = Math.max(-0.25, Math.min(0.25, dx * 0.01));
      if (m.minion) {
        const onRow = Math.abs(p.y - boardRowY('near')) < BOARD_ROW_HALF + 40;
        const count = this.scene.view.players[this.scene.view.viewer].board.length;
        const gap = onRow ? boardInsertIndex(p.x, count) : null;
        // 拖到随从行上时牌缩小，不挡住空位阴影
        m.card.scale.set(onRow ? 0.6 : 1);
        if (gap !== this.scene.boardGap) {
          this.scene.boardGap = gap;
          this.scene.layoutBoard();
        }
      } else if (p.y < HAND_TOP_Y) {
        // 法术拖出手牌区：定向法术进入选目标状态
        const targeted = m.options.filter((a) => a.kind === 'play_card' && a.target);
        if (targeted.length > 0) {
          const card = m.card;
          const handIndex = m.handIndex;
          const slot = castSlot();
          card.position.set(slot.x, slot.y);
          card.scale.set(slot.scale);
          card.rotation = 0;
          this.startAim({
            from: { x: slot.x, y: slot.y - 60 },
            options: targeted.map((a) => ({ target: (a as { target: TargetRef }).target, action: a })),
            release: true,
            onCancel: () => this.returnCard(card),
            spellCard: { card, handIndex },
          });
          this.mode.k === 'aim' && this.scene.arrow.update(p, false);
        }
      }
      return;
    }
    if (m.k === 'aim') {
      if (m.spellCard && p.y > HAND_TOP_Y + 20) {
        // 拖回手牌区：回到拖牌状态
        const { card, handIndex } = m.spellCard;
        const options = (this.host.legal() ?? []).filter((a) => a.kind === 'play_card' && a.handIndex === handIndex);
        this.scene.arrow.stop();
        this.scene.setTargetMarks(null);
        card.scale.set(1);
        this.mode = { k: 'drag', card, handIndex, minion: false, options };
        return;
      }
      const hit = this.targetAt(p);
      const onTarget = !!hit && m.options.some((o) => sameRef(o.target, hit));
      this.scene.arrow.update(p, onTarget);
      return;
    }
    this.updateHover(p);
  }

  private onUp(e: FederatedPointerEvent): void {
    if (e.button !== 0) return;
    const p = this.local(e);
    const m = this.mode;
    if (m.k === 'drag') {
      this.dropCard(m, p);
      return;
    }
    if (m.k === 'aim' && m.release) {
      const hit = this.targetAt(p);
      const opt = hit && m.options.find((o) => sameRef(o.target, hit));
      if (opt) this.commit(opt.action);
      else this.cancel();
    }
  }

  // ---------- 拖牌 ----------

  private startDrag(card: CardView, handIndex: number, options: Action[], p: Point): void {
    const minion = getCard(card.cardId).type === 'minion';
    this.setHover(null);
    this.scene.hoveredHand = null;
    this.scene.draggingHand = card.instanceId;
    card.setHighlight(true);
    this.scene.layers.drag.addChild(card);
    card.position.set(p.x, p.y);
    card.scale.set(1);
    this.mode = { k: 'drag', card, handIndex, minion, options };
    this.scene.layoutHand();
  }

  private dropCard(m: DragCard, p: Point): void {
    if (m.minion) {
      const gap = this.scene.boardGap;
      if (gap === null) return this.cancel();
      const here = m.options.filter((a) => a.kind === 'play_card' && a.position === gap);
      if (here.length === 0) return this.cancel();
      const untargeted = here.find((a) => a.kind === 'play_card' && !a.target);
      if (untargeted) return this.commit(untargeted);
      // 需要目标的战吼：牌停在空位上，从那里拉出箭头，点目标提交
      const count = this.scene.view.players[this.scene.view.viewer].board.length;
      const slot = boardSlot('near', gap, count, gap);
      m.card.position.set(slot.x, slot.y);
      m.card.scale.set(0.6);
      m.card.rotation = 0;
      const card = m.card;
      this.startAim({
        from: { x: slot.x, y: slot.y },
        options: here.map((a) => ({ target: (a as { target: TargetRef }).target, action: a })),
        release: false,
        onCancel: () => this.returnCard(card),
      });
      return;
    }
    // 法术：拖出手牌区松手即用（无目标）；定向法术在 onMove 里已经进入选目标状态
    if (p.y < HAND_TOP_Y) {
      const untargeted = m.options.find((a) => a.kind === 'play_card' && !a.target);
      if (untargeted) return this.commit(untargeted);
    }
    this.cancel();
  }

  private returnCard(card: CardView): void {
    this.scene.layers.handNear.addChild(card);
    this.scene.draggingHand = null;
    this.scene.boardGap = null;
    this.scene.layoutHand();
    this.scene.layoutBoard();
  }

  // ---------- 选目标 ----------

  private startAim(a: Omit<Aim, 'k'>): void {
    this.setHover(null);
    this.mode = { k: 'aim', ...a };
    this.scene.arrow.start(a.from, COLORS.target);
    this.scene.setTargetMarks({ targets: a.options.map((o) => o.target) });
  }

  private commit(action: Action): void {
    const legal = this.host.legal();
    // 防御：提交前再核对一次，动作必须在当前合法列表里
    if (!legal || !legal.some((a) => actionKey(a) === actionKey(action))) {
      this.cancel();
      return;
    }
    this.scene.arrow.stop();
    this.scene.setTargetMarks(null);
    this.scene.boardGap = null;
    this.mode = { k: 'idle' };
    // 打出的牌留在松手的位置，card_played 动画接管它（takeHandCard 时清掉 draggingHand）
    this.host.submit(action);
  }

  cancel(): void {
    const m = this.mode;
    this.mode = { k: 'idle' };
    this.scene.arrow.stop();
    this.scene.setTargetMarks(null);
    if (m.k === 'drag') this.returnCard(m.card);
    else if (m.k === 'aim') m.onCancel();
    if (this.scene.boardGap !== null) {
      this.scene.boardGap = null;
      this.scene.layoutBoard();
    }
  }

  // ---------- 悬停 ----------

  private updateHover(p: Point): void {
    const card = this.handCardAt(p);
    const id = card ? card.instanceId : null;
    if (id !== this.scene.hoveredHand && this.scene.view.phase === 'playing') {
      this.scene.hoveredHand = id;
      this.scene.layoutHand(0.12);
    }
    if (card) return this.setHover(card.hidden ? null : { kind: 'hand', instanceId: card.instanceId });
    const minion = this.minionAt(p);
    if (minion) return this.setHover({ kind: 'minion', instanceId: minion.instanceId, side: minion.side });
    const me = this.scene.view.viewer;
    if (this.overHeroPower(p)) return this.setHover({ kind: 'hero_power', side: me });
    this.setHover(null);
  }

  private setHover(h: HoverInfo | null): void {
    const same =
      h === this.hovered ||
      (h !== null && this.hovered !== null && JSON.stringify(h) === JSON.stringify(this.hovered));
    if (same) return;
    this.hovered = h;
    this.host.hover(h);
  }

  // ---------- 命中判定（逻辑坐标） ----------

  private handCardAt(p: Point): CardView | null {
    const layer = this.scene.layers.handNear;
    const cards = [...this.scene.handCards.values()].filter((c) => c.parent === layer);
    cards.sort((a, b) => b.zIndex - a.zIndex);
    for (const c of cards) {
      const local = c.toLocal(p, this.scene.root);
      if (Math.abs(local.x) <= CARD_W / 2 && Math.abs(local.y) <= CARD_H / 2) return c;
    }
    return null;
  }

  private minionAt(p: Point) {
    for (const m of this.scene.minions.values()) {
      if (Math.abs(p.x - m.x) <= 62 && Math.abs(p.y - m.y) <= 78) return m;
    }
    return null;
  }

  private targetAt(p: Point): TargetRef | null {
    const m = this.minionAt(p);
    if (m) return { side: m.side, kind: 'minion', instanceId: m.instanceId };
    for (const side of [0, 1] as const) {
      const h = this.scene.heroes[side];
      if (Math.hypot(p.x - h.x, p.y - h.y) <= h.radius) return { side, kind: 'hero' };
    }
    return null;
  }

  private overHeroPower(p: Point): boolean {
    const hp = this.scene.heroPowerPoint(this.scene.view.viewer);
    return Math.abs(p.x - hp.x) <= 44 && Math.abs(p.y - hp.y) <= 44;
  }

  private overEndTurn(p: Point): boolean {
    const b = this.scene.endTurn;
    return Math.abs(p.x - b.x) <= 100 && Math.abs(p.y - b.y) <= 40;
  }
}

function handIndexOf(view: TableScene['view'], instanceId: number): number {
  return view.players[view.viewer].hand.findIndex((c) => c.instanceId === instanceId);
}

