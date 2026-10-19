// 输入（spec 5.3、6.6）。拾取用射线检测；拖拽时把指针投影到平面上算位置：拖着的牌在台面上方一个水平面上
// 跟随指针，落点判定用指针在台面上的投影点。
// 能做什么只看宿主给的合法操作列表（来自真实局面的 listLegalActions），这里不自己判断规则；宿主在显示
// 局面追上真实局面之前、对方回合里返回 null，表示锁定。锁定时仍然可以悬停看牌、快进动画。
import * as THREE from 'three';
import { actionKey, getCard, type Action, type TargetRef } from '../engine';
import type { Point } from '../presentation/fx/arrow';
import { BOARD_ROW_HALF, boardInsertIndex, boardRowZ, boardSlot, castSlot, CAMERA_PITCH, HAND_ZONE_Z } from '../presentation/layout';
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

type Pick =
  | { kind: 'hand'; id: number }
  | { kind: 'minion'; id: number; side: 0 | 1 }
  | { kind: 'hero'; side: 0 | 1 }
  | { kind: 'hero_power'; side: 0 | 1 }
  | { kind: 'deck'; side: 0 | 1 }
  | { kind: 'end_turn' };

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

const DRAG_HEIGHT = 2.2; // 拖着的牌所在水平面的高度
const sameRef = (a: TargetRef, b: TargetRef) =>
  a.side === b.side && a.kind === b.kind && (a.kind === 'hero' || (b.kind === 'minion' && a.instanceId === b.instanceId));

export class Interaction {
  private mode: Mode = { k: 'idle' };
  private hovered: HoverInfo | null = null;
  private hoveredDeck: 0 | 1 | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_HEIGHT);
  private lastDrag: THREE.Vector3 | null = null;
  private readonly canvas: HTMLCanvasElement;

  constructor(
    private readonly scene: TableScene,
    private readonly host: InteractionHost,
  ) {
    this.canvas = scene.stage.canvas;
    this.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKey);
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.style.cursor = 'default';
  }

  // 显示局面或合法操作变化后调用，刷新高亮。
  refresh(): void {
    const legal = this.host.legal();
    if (!legal && this.mode.k !== 'idle') this.cancel();
    this.canvas.style.cursor = this.host.waiting() ? 'wait' : 'default';
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

  // ---------- 射线 ----------

  private aim(e: { clientX: number; clientY: number }): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.scene.stage.camera);
  }

  private pick(): Pick | null {
    const L = this.scene.layers;
    const hits = this.ray.intersectObjects([L.handNear, L.minions, L.heroes], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o) return o.userData.pick as Pick;
    }
    return null;
  }

  private planePoint(plane: THREE.Plane): THREE.Vector3 | null {
    return this.ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  private targetOf(p: Pick | null): TargetRef | null {
    if (!p) return null;
    if (p.kind === 'minion') return { side: p.side, kind: 'minion', instanceId: p.id };
    if (p.kind === 'hero') return { side: p.side, kind: 'hero' };
    return null;
  }

  // ---------- 事件 ----------

  private onContext = (e: Event) => e.preventDefault();

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.host.busy()) this.host.fastForward();
    } else if (e.code === 'Escape') this.cancel();
  };

  private onDown = (e: PointerEvent) => {
    this.aim(e);
    if (e.button === 2) {
      this.cancel();
      return;
    }
    if (e.button !== 0) return;
    if (this.host.busy()) {
      this.host.fastForward();
      return;
    }
    const hit = this.pick();
    const legal = this.host.legal();
    if (!legal) return;
    const view = this.scene.view;
    const me = view.viewer;

    if (this.mode.k === 'aim' && !this.mode.release) {
      const t = this.targetOf(hit);
      const opt = t && this.mode.options.find((o) => sameRef(o.target, t));
      if (opt) this.commit(opt.action);
      else this.cancel();
      return;
    }
    if (this.mode.k !== 'idle' || !hit) return;

    if (hit.kind === 'end_turn') {
      if (this.scene.endTurn.mode === 'mine' && legal.some((a) => a.kind === 'end_turn')) this.commit({ kind: 'end_turn' });
      return;
    }

    if (view.phase === 'mulligan') {
      if (hit.kind !== 'hand') return;
      const idx = handIndexOf(view, hit.id);
      if (!legal.some((a) => a.kind === 'mulligan' && a.replace.includes(idx))) return;
      const marks = this.scene.mulliganMarks;
      if (marks.has(hit.id)) marks.delete(hit.id);
      else marks.add(hit.id);
      this.scene.layoutHand(0.1);
      this.host.mulliganChanged(new Set(marks));
      return;
    }

    if (hit.kind === 'hand') {
      const card = this.scene.handCards.get(hit.id);
      const handIndex = handIndexOf(view, hit.id);
      const options = legal.filter((a) => a.kind === 'play_card' && a.handIndex === handIndex);
      if (card && options.length > 0) this.startDrag(card, handIndex, options);
      return;
    }

    if (hit.kind === 'minion' && hit.side === me) {
      const attacker: TargetRef = { side: me, kind: 'minion', instanceId: hit.id };
      const options = legal
        .filter((a): a is Extract<Action, { kind: 'attack' }> => a.kind === 'attack' && sameRef(a.attacker, attacker))
        .map((a) => ({ target: a.target, action: a as Action }));
      if (options.length > 0) this.startAim({ from: this.scene.pointOf(attacker), options, release: true, onCancel: () => {} });
      return;
    }

    if (hit.kind === 'hero_power' && hit.side === me) {
      const powers = legal.filter((a): a is Extract<Action, { kind: 'hero_power' }> => a.kind === 'hero_power');
      if (powers.length === 0) return;
      if (powers.length === 1 && !powers[0].target) this.commit(powers[0]);
      else {
        const options = powers.filter((a) => a.target).map((a) => ({ target: a.target!, action: a as Action }));
        this.startAim({ from: this.scene.heroPowerPoint(me), options, release: false, onCancel: () => {} });
      }
    }
  };

  private onMove = (e: PointerEvent) => {
    this.aim(e);
    const m = this.mode;
    const table = this.planePoint(this.tablePlane);
    if (m.k === 'drag') {
      const at = this.planePoint(this.dragPlane);
      if (at) {
        // 跟随指针，按移动速度倾斜
        const v = this.lastDrag ? at.clone().sub(this.lastDrag) : new THREE.Vector3();
        this.lastDrag = at.clone();
        m.card.position.copy(at);
        m.card.rotation.set(-CAMERA_PITCH * 0.75 + THREE.MathUtils.clamp(v.z * 0.6, -0.35, 0.35), 0, THREE.MathUtils.clamp(-v.x * 0.5, -0.4, 0.4));
      }
      if (m.minion) {
        const onRow = !!table && Math.abs(table.z - boardRowZ('near')) < BOARD_ROW_HALF;
        const count = this.scene.view.players[this.scene.view.viewer].board.length;
        const gap = onRow && table ? boardInsertIndex(table.x, count) : null;
        // 拖到随从行上时牌缩小，不挡住空位
        m.card.scale.setScalar(onRow ? 0.6 : 1);
        if (gap !== this.scene.boardGap) {
          this.scene.boardGap = gap;
          this.scene.layoutBoard();
        }
      } else if (table && table.z < HAND_ZONE_Z) {
        // 法术拖出手牌区：定向法术进入选目标状态
        const targeted = m.options.filter((a) => a.kind === 'play_card' && a.target);
        if (targeted.length > 0) {
          const card = m.card;
          const handIndex = m.handIndex;
          const slot = castSlot();
          card.position.set(slot.pos.x, slot.pos.y, slot.pos.z);
          card.rotation.set(slot.rot.x, slot.rot.y, slot.rot.z);
          card.scale.setScalar(slot.scale);
          this.startAim({
            from: { x: slot.pos.x, y: slot.pos.y - 0.6, z: slot.pos.z - 0.4 },
            options: targeted.map((a) => ({ target: (a as { target: TargetRef }).target, action: a })),
            release: true,
            onCancel: () => this.returnCard(card),
            spellCard: { card, handIndex },
          });
        }
      }
      return;
    }
    if (m.k === 'aim') {
      if (m.spellCard && table && table.z > HAND_ZONE_Z + 0.3) {
        // 拖回手牌区：回到拖牌状态
        const { card, handIndex } = m.spellCard;
        const options = (this.host.legal() ?? []).filter((a) => a.kind === 'play_card' && a.handIndex === handIndex);
        this.scene.arrow.stop();
        this.scene.setTargetMarks(null);
        card.scale.setScalar(1);
        this.lastDrag = null;
        this.mode = { k: 'drag', card, handIndex, minion: false, options };
        return;
      }
      const t = this.targetOf(this.pick());
      const opt = t && m.options.find((o) => sameRef(o.target, t));
      const to = opt ? this.scene.pointOf(opt.target) : table ? { x: table.x, y: 0.3, z: table.z } : m.from;
      this.scene.arrow.update(to, !!opt);
      return;
    }
    if (e.target !== this.canvas) return;
    this.updateHover(this.pick());
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.aim(e);
    const m = this.mode;
    if (m.k === 'drag') {
      this.dropCard(m);
      return;
    }
    if (m.k === 'aim' && m.release) {
      const t = this.targetOf(this.pick());
      const opt = t && m.options.find((o) => sameRef(o.target, t));
      if (opt) this.commit(opt.action);
      else this.cancel();
    }
  };

  // ---------- 拖牌 ----------

  private startDrag(card: CardView, handIndex: number, options: Action[]): void {
    const minion = getCard(card.cardId).type === 'minion';
    this.setHover(null);
    this.scene.hoveredHand = null;
    this.scene.draggingHand = card.instanceId;
    card.setHighlight(true);
    this.scene.layers.drag.add(card);
    card.scale.setScalar(1);
    this.lastDrag = null;
    this.mode = { k: 'drag', card, handIndex, minion, options };
    this.scene.layoutHand();
  }

  private dropCard(m: DragCard): void {
    const table = this.planePoint(this.tablePlane);
    if (m.minion) {
      const gap = this.scene.boardGap;
      if (gap === null) return this.cancel();
      const here = m.options.filter((a) => a.kind === 'play_card' && a.position === gap);
      if (here.length === 0) return this.cancel();
      const untargeted = here.find((a) => a.kind === 'play_card' && !a.target);
      if (untargeted) return this.commit(untargeted);
      // 需要目标的战吼：牌停在空位上方，从那里拉出箭头，点目标提交
      const count = this.scene.view.players[this.scene.view.viewer].board.length;
      const slot = boardSlot('near', gap, count, gap);
      m.card.position.set(slot.pos.x, 0.9, slot.pos.z);
      m.card.rotation.set(-CAMERA_PITCH, 0, 0);
      m.card.scale.setScalar(0.6);
      const card = m.card;
      this.startAim({
        from: { x: slot.pos.x, y: 0.5, z: slot.pos.z },
        options: here.map((a) => ({ target: (a as { target: TargetRef }).target, action: a })),
        release: false,
        onCancel: () => this.returnCard(card),
      });
      return;
    }
    // 法术：拖出手牌区松手即用（无目标）；定向法术在拖动时已经进入选目标状态
    if (table && table.z < HAND_ZONE_Z) {
      const untargeted = m.options.find((a) => a.kind === 'play_card' && !a.target);
      if (untargeted) return this.commit(untargeted);
    }
    this.cancel();
  }

  private returnCard(card: CardView): void {
    this.scene.layers.handNear.add(card);
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

  private updateHover(hit: Pick | null): void {
    const handId = hit?.kind === 'hand' ? hit.id : null;
    if (handId !== this.scene.hoveredHand && this.scene.view.phase === 'playing') {
      this.scene.hoveredHand = handId;
      this.scene.layoutHand(0.12);
    }
    const deck = hit?.kind === 'deck' ? hit.side : null;
    if (deck !== this.hoveredDeck) {
      if (this.hoveredDeck !== null) this.scene.decks[this.hoveredDeck].showCount(false);
      if (deck !== null) this.scene.decks[deck].showCount(true);
      this.hoveredDeck = deck;
    }
    if (hit?.kind === 'hand') {
      const card = this.scene.handCards.get(hit.id);
      return this.setHover(card && !card.hidden ? { kind: 'hand', instanceId: hit.id } : null);
    }
    if (hit?.kind === 'minion') return this.setHover({ kind: 'minion', instanceId: hit.id, side: hit.side });
    if (hit?.kind === 'hero_power') return this.setHover({ kind: 'hero_power', side: hit.side });
    this.setHover(null);
  }

  private setHover(h: HoverInfo | null): void {
    if (JSON.stringify(h) === JSON.stringify(this.hovered)) return;
    this.hovered = h;
    this.host.hover(h);
  }
}

function handIndexOf(view: TableScene['view'], instanceId: number): number {
  return view.players[view.viewer].hand.findIndex((c) => c.instanceId === instanceId);
}
