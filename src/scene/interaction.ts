// 输入（spec 5.3、6.6）。拾取用射线检测；拖拽时把指针投影到平面上算位置：拖着的牌在台面上方一个水平面上
// 跟随指针，落点判定用指针在台面上的投影点。
// 能做什么只看宿主给的合法操作列表（来自真实局面的 listLegalActions），这里不自己判断规则；宿主在显示
// 局面追上真实局面之前、对方回合里返回 null，表示锁定。锁定时仍然可以悬停看牌、快进动画。
import gsap from 'gsap';
import * as THREE from 'three';
import { actionKey, getCard, type Action, type TargetRef } from '../engine';
import type { Point } from '../presentation/fx/arrow';
import { BOARD_ROW_HALF, boardInsertIndex, boardRowZ, boardSlot, CARD_H, CARD_W, castSlot, CAMERA_PITCH, HAND_ZONE_Z } from '../presentation/layout';
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

const DRAG_HEIGHT = 2.2; // 指针投影用的水平面高度

// 拿起实体卡的手感参数（spec 5.3 v0.6.2、m4-storyboard §2）。调试台 /dev/fx 里可以现场调。
export const DRAG = {
  frequency: 6, // 跟随弹簧的角频率（Hz）
  damping: 0.7, // 阻尼比：小于 1 时停下会稍微过冲再回正
  maxLag: 0.3, // 最多落后指针几个卡宽
  tiltPerSpeed: 6, // 每 1 卡宽/秒的速度倾几度
  maxTilt: 18, // 倾角上限（度）
  roll: 0.5, // 左右拖时绕竖轴转的比例（相对倾角）
  lift: 0.25, // 拿起时离开台面多少，按卡高算
  pickScale: 1.08, // 拿起时放大
  rowScale: 0.62, // 拖到我方随从行上时缩到多大、转平，过渡成底座预览
  returnTime: 0.3, // 取消时沿弧线回到手牌的时长（秒）
};

// 台面上的软投影：拿起的牌越高，投影越大越淡
const blobTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
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
  private readonly canvas: HTMLCanvasElement;
  // 拖牌的弹簧状态：pos 和 vel 是牌，target 是指针投影点；row 是"在随从行上"的程度（0 到 1，平滑过渡）
  private readonly spring = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(), row: 0, rowTarget: 0, slot: new THREE.Vector3() };
  private readonly blob: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly unhookFrame: () => void;

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
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1.4),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.5 }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.visible = false;
    scene.layers.fx.add(this.blob);
    this.unhookFrame = scene.stage.onFrame((dt) => this.tick(dt));
  }

  destroy(): void {
    this.unhookFrame();
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
      if (this.scene.endTurn.mode === 'mine' && legal.some((a) => a.kind === 'end_turn')) {
        this.scene.endTurn.press();
        this.commit({ kind: 'end_turn' });
      }
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
      // 只更新弹簧的目标点，牌在每帧的 tick 里跟过去
      const at = this.planePoint(this.dragPlane);
      if (at) this.spring.target.set(at.x, DRAG_HEIGHT + DRAG.lift * CARD_H, at.z);
      if (m.minion) {
        const onRow = !!table && Math.abs(table.z - boardRowZ('near')) < BOARD_ROW_HALF;
        const count = this.scene.view.players[this.scene.view.viewer].board.length;
        const gap = onRow && table ? boardInsertIndex(table.x, count) : null;
        // 拖到随从行上：牌逐渐缩小、转平、降低，过渡成底座预览；落点两边的随从带弹性地让开
        this.spring.rowTarget = onRow ? 1 : 0;
        // 预览落在空位上方：在随从行上时位置往空位靠
        if (gap !== null) {
          const s = boardSlot('near', gap, count, gap).pos;
          this.spring.slot.set(s.x, 0, s.z);
        } else if (table) this.spring.slot.set(table.x, 0, table.z);
        if (gap !== this.scene.boardGap) {
          this.scene.boardGap = gap;
          this.scene.layoutBoard(0.28, 'back.out(1.6)');
        }
      } else if (table && table.z < HAND_ZONE_Z) {
        // 法术拖出手牌区：定向法术进入选目标状态
        const targeted = m.options.filter((a) => a.kind === 'play_card' && a.target);
        if (targeted.length > 0) {
          const card = m.card;
          const handIndex = m.handIndex;
          const slot = castSlot();
          this.blob.visible = false;
          gsap.to(card.position, { ...slot.pos, duration: 0.18, ease: 'power2.out', overwrite: 'auto' });
          gsap.to(card.rotation, { ...slot.rot, duration: 0.18, ease: 'power2.out', overwrite: 'auto' });
          gsap.to(card.scale, { x: slot.scale, y: slot.scale, z: slot.scale, duration: 0.18, overwrite: 'auto' });
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
        gsap.killTweensOf([card.position, card.rotation, card.scale]);
        this.beginSpring(card);
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
    gsap.killTweensOf([card.position, card.rotation, card.scale]);
    this.scene.layers.drag.add(card);
    this.beginSpring(card);
    this.mode = { k: 'drag', card, handIndex, minion, options };
    // 剩下的手牌带弹性地重新排开
    this.scene.layoutHand(0.25, 'back.out(1.5)');
  }

  private beginSpring(card: CardView): void {
    const sp = this.spring;
    sp.pos.copy(card.position);
    sp.vel.set(0, 0, 0);
    sp.target.copy(card.position);
    sp.target.y = DRAG_HEIGHT + DRAG.lift * CARD_H;
    sp.row = 0;
    sp.rowTarget = 0;
    this.blob.visible = true;
  }

  // 每帧推进拖牌的弹簧：阻尼弹簧跟随指针，速度决定倾角和翻滚，拿起的高度决定投影大小和深浅
  private tick(dt: number): void {
    const m = this.mode;
    if (m.k !== 'drag') return;
    const sp = this.spring;
    const w = 2 * Math.PI * DRAG.frequency;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const scale0 = 1.3; // 手牌的缩放
    const cardW = CARD_W * scale0;
    for (let i = 0; i < steps; i++) {
      // 半隐式欧拉：a = -ω²(x - 目标) - 2ζω·v
      const ax = -w * w * (sp.pos.x - sp.target.x) - 2 * DRAG.damping * w * sp.vel.x;
      const ay = -w * w * (sp.pos.y - sp.target.y) - 2 * DRAG.damping * w * sp.vel.y;
      const az = -w * w * (sp.pos.z - sp.target.z) - 2 * DRAG.damping * w * sp.vel.z;
      sp.vel.x += ax * h;
      sp.vel.y += ay * h;
      sp.vel.z += az * h;
      sp.pos.addScaledVector(sp.vel, h);
    }
    // 最多落后指针 maxLag 个卡宽
    const lag = new THREE.Vector3().subVectors(sp.pos, sp.target);
    lag.y = 0;
    const maxLag = DRAG.maxLag * cardW;
    if (lag.length() > maxLag) {
      lag.setLength(maxLag);
      sp.pos.x = sp.target.x + lag.x;
      sp.pos.z = sp.target.z + lag.z;
    }
    sp.row += (sp.rowTarget - sp.row) * Math.min(1, dt * 10);
    const row = sp.row;
    // 倾角：每 1 卡宽/秒倾 tiltPerSpeed 度，上限 maxTilt，往运动方向倾；速度由弹簧给出，所以停下时会带一点回弹地回正
    const deg = THREE.MathUtils.degToRad;
    const tilt = (v: number) => THREE.MathUtils.clamp((v / cardW) * deg(DRAG.tiltPerSpeed), -deg(DRAG.maxTilt), deg(DRAG.maxTilt));
    const tx = tilt(sp.vel.x);
    const tz = tilt(sp.vel.z);
    const card = m.card;
    const rowY = 0.9; // 随从行上方的预览高度
    card.position.set(
      sp.pos.x + (sp.slot.x - sp.pos.x) * row,
      sp.pos.y + (rowY - sp.pos.y) * row,
      sp.pos.z + (sp.slot.z - sp.pos.z) * row,
    );
    const upright = -CAMERA_PITCH * 0.72;
    card.rotation.set(
      upright + (-Math.PI / 2 - upright) * row + tz * (1 - row),
      -tx * DRAG.roll * (1 - row),
      -tx * (1 - row),
    );
    const sc = scale0 * (DRAG.pickScale + (DRAG.rowScale - DRAG.pickScale) * row);
    card.scale.setScalar(sc);
    // 软投影：落在牌正下方的台面上，越高越大越淡
    const height = card.position.y;
    this.blob.position.set(card.position.x, 0.03, card.position.z);
    this.blob.scale.setScalar(sc * (0.9 + height * 0.35));
    this.blob.material.opacity = 0.55 / (1 + height * 0.5);
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

  // 取消：牌沿一条拱起的弧线回到手牌里自己的位置，不是瞬移
  private returnCard(card: CardView): void {
    this.blob.visible = false;
    this.scene.draggingHand = null;
    this.scene.boardGap = null;
    this.scene.layoutBoard(0.25, 'back.out(1.4)');
    const slot = this.scene.handSlotOf(card.instanceId);
    if (!slot) {
      this.scene.layers.handNear.add(card);
      this.scene.layoutHand();
      return;
    }
    this.scene.returningHand.add(card.instanceId);
    this.scene.layoutHand(0.25, 'back.out(1.4)');
    gsap.killTweensOf([card.position, card.rotation, card.scale]);
    const from = card.position.clone();
    const to = new THREE.Vector3(slot.pos.x, slot.pos.y, slot.pos.z);
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 0.9;
    const r0 = card.rotation.clone();
    const s0 = card.scale.x;
    const st = { t: 0 };
    const bez = new THREE.QuadraticBezierCurve3(from, mid, to);
    gsap.to(st, {
      t: 1,
      duration: DRAG.returnTime,
      ease: 'power2.out',
      onUpdate: () => {
        card.position.copy(bez.getPoint(st.t));
        card.rotation.set(r0.x + (slot.rot.x - r0.x) * st.t, r0.y + (slot.rot.y - r0.y) * st.t, r0.z + (slot.rot.z - r0.z) * st.t);
        card.scale.setScalar(s0 + (slot.scale - s0) * st.t);
      },
      onComplete: () => {
        this.scene.returningHand.delete(card.instanceId);
        this.scene.layers.handNear.add(card);
        this.scene.layoutHand(0.12);
      },
    });
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
    // 打出随从：空位一直留到砸落那一刻（minion_summoned 清掉），相邻随从不先合拢再让开
    if (!(action.kind === 'play_card' && action.position !== undefined)) this.scene.boardGap = null;
    this.blob.visible = false;
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
    this.scene.endTurn.setHover(hit?.kind === 'end_turn');
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
