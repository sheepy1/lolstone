// 对局场景：按显示局面摆放台面上的一切（spec 5.8 "Three.js 场景按显示局面渲染"）。
// sync(view) 把场景对到显示局面：缺的物件建出来，多的移走，每个物件滑到布局给出的槽位，数值刷新。
// 动画模块在 sync 前后加自己的表现；手牌和随从以实例 id 为键，同一个物件从牌库一路跟到手牌、场上。
import gsap from 'gsap';
import * as THREE from 'three';
import { findCard, MANA_POTION_ID, other, type Side, type TargetRef } from '../engine';
import { TargetArrow, type Point } from '../presentation/fx/arrow';
import {
  above,
  CAMERA,
  boardSlot,
  CARD_H,
  CARD_W,
  CAMERA_PITCH,
  deckSlot,
  endTurnSlot,
  handHoverSlot,
  handNeighborShift,
  handSlot,
  heroPowerSlot,
  heroSlot,
  inspectSlot,
  manaSlot,
  mulliganPotionSlot,
  mulliganSlot,
  placementOf,
  type Placement,
  type Slot,
} from '../presentation/layout';
import { Text } from 'troika-three-text';
import { cardFontUrl } from '../assets/manifest';
import { ParticleSystem } from '../presentation/fx/particles';
import { warmCombatFx } from '../presentation/fx/warm';
import type { ViewState } from '../presentation/viewState';
import { CardView, glowMat as playableGlow } from './cardView';
import type { CardStats } from './cardText';
import { fadeOutAndDispose, releaseGpu } from './dispose';
import { HeroPowerView, HeroView } from './heroView';
import { attackRimMat, MinionView } from './minionView';
import { useLampReflections } from './nexusLamps';
import type { Stage } from './stage';
import { BoardView } from './board';
import { EndTurnButton, useButtonReflections } from './endTurnButton';
import { DeckView, ManaBarView, ThinkingView } from './tableParts';

export type LegalHighlights = {
  playable: Set<number>; // 能打出的手牌实例 id
  attackers: Set<number>; // 能攻击的随从实例 id
  heroPower: boolean;
  endTurnReady: boolean; // 除了结束回合没有别的事可做
};

export type TargetMarks = { targets: TargetRef[] } | null;

const LAYOUT_DURATION = 0.3;

function put(obj: THREE.Object3D, s: Slot): void {
  obj.position.set(s.pos.x, s.pos.y, s.pos.z);
  obj.rotation.set(s.rot.x, s.rot.y, s.rot.z);
  obj.scale.setScalar(s.scale);
}

// 滑到槽位。返回是否需要移动。
function moveTo(obj: THREE.Object3D, s: Slot, duration: number, ease = 'power2.out'): boolean {
  const p = obj.position;
  const r = obj.rotation;
  const far =
    Math.abs(p.x - s.pos.x) + Math.abs(p.y - s.pos.y) + Math.abs(p.z - s.pos.z) > 0.005 ||
    Math.abs(r.x - s.rot.x) + Math.abs(r.y - s.rot.y) + Math.abs(r.z - s.rot.z) > 0.005 ||
    Math.abs(obj.scale.x - s.scale) > 0.005;
  if (!far) return false;
  if (duration <= 0) {
    gsap.killTweensOf([obj.position, obj.rotation, obj.scale]);
    put(obj, s);
    return true;
  }
  gsap.to(obj.position, { ...s.pos, duration, ease, overwrite: 'auto' });
  gsap.to(obj.rotation, { ...s.rot, duration, ease, overwrite: 'auto' });
  gsap.to(obj.scale, { x: s.scale, y: s.scale, z: s.scale, duration, ease, overwrite: 'auto' });
  return true;
}

const PULSE_BASE: [THREE.MeshBasicMaterial, THREE.Color][] = [playableGlow, attackRimMat].map((m) => [m, m.color.clone()]);

export class TableScene {
  readonly root = new THREE.Group();
  readonly layers = {
    board: new THREE.Group(),
    heroes: new THREE.Group(),
    minions: new THREE.Group(),
    handFar: new THREE.Group(),
    handNear: new THREE.Group(),
    fx: new THREE.Group(),
    drag: new THREE.Group(),
    top: new THREE.Group(),
  };
  readonly arrow = new TargetArrow();
  readonly board = new BoardView();
  readonly heroes: [HeroView, HeroView];
  readonly heroPowers: [HeroPowerView, HeroPowerView];
  readonly decks: [DeckView, DeckView] = [new DeckView(0), new DeckView(1)];
  readonly mana: [ManaBarView, ManaBarView] = [new ManaBarView(), new ManaBarView()];
  readonly endTurn = new EndTurnButton();
  readonly thinking = new ThinkingView();
  readonly handCards = new Map<number, CardView>();
  readonly minions = new Map<number, MinionView>();
  view: ViewState;

  // 交互状态，布局时要考虑
  hoveredHand: number | null = null;
  draggingHand: number | null = null;
  // 正沿弧线飞回手牌的牌：参与手牌排位，但位置由飞行动画管
  readonly returningHand = new Set<number>();
  // 正在从牌库飞进手牌的牌（E03）：飞行由动画模块自己做，布局同步不去挪它，落位后再并进扇形
  readonly incomingHand = new Set<number>();
  // 由动画模块接管入场的随从：sync 建出来时先藏起来，不做默认的落下动画
  readonly heldSpawns = new Set<number>();
  // 自己打出、悬在落点上方等着砸落的随从牌（card_played 放进来，minion_summoned 取走）
  readonly pendingPlayCards = new Map<number, CardView>();
  boardGap: number | null = null; // 我方随从行空出的位置
  mulliganMarks = new Set<number>();
  // 新手牌的出发点（默认从牌库飞出；回手的牌从随从原来的位置飞出）
  readonly handSpawn = new Map<number, Point>();
  // 随从最后所在的位置，离场后的事件（亡语）用它定位
  private lastMinionPos = new Map<number, Point>();
  // 悬停场上随从、英雄技能时左侧放大的卡（场景里的卡牌网格，和场上同一套光照）
  private inspect: CardView | null = null;
  private highlights: LegalHighlights | null = null;
  private targetMarks: TargetMarks = null;
  private readonly unhook: () => void;
  // 事件动画用的粒子（presentation/fx/particles）。挂在场景根上，位置都是世界坐标；每帧跟着渲染推进，
  // 乘全局时间线的 timeScale，导演快进、调试台慢放时粒子一起快、一起慢
  readonly particles: ParticleSystem;
  // 开局演出（E01）进行中：换牌的压暗板先不出来
  intro = false;
  // 每个显示局面属于第几步（播放器在每步开始时登记）。组间重叠时，前一步收尾里的同步可能晚于后一步的同步；
  // 同步到比最新那步更旧的局面会把后一步刚放上去的牌、随从挪走，所以这种过时的同步直接跳过
  private readonly viewSeq = new WeakMap<ViewState, number>();
  private newestSeq = 0;
  // 为 true 时，sync 新建的手牌直接放在目标槽位上（不从牌库滑过去），由动画模块自己做从牌库飞来的那一段
  spawnAtSlot = false;
  // 胜负定格（E28、E29）：河水、灯、法力水晶这些常驻的小动画停下
  frozen = false;
  // 换牌时法力药水下面的说明
  private potionCaption: Text | null = null;
  // 换牌阶段压暗棋盘：一块朝镜头的半透明黑板，挡在台面前、起手牌后
  private readonly shade = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 40),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
  );

  constructor(
    view: ViewState,
    readonly stage: Stage,
  ) {
    this.view = view;
    const v = view.viewer;
    useLampReflections(stage.reflections);
    useButtonReflections(stage.reflections);
    this.heroes = [new HeroView(view.players[0].heroClass, v !== 0, 0), new HeroView(view.players[1].heroClass, v !== 1, 1)];
    this.heroPowers = [new HeroPowerView(view.players[0].heroClass, 0), new HeroPowerView(view.players[1].heroClass, 1)];
    this.addLights();
    const L = this.layers;
    L.board.add(this.board);
    for (const side of [0, 1] as Side[]) {
      const p = this.place(side);
      put(this.heroes[side], heroSlot(p));
      put(this.heroPowers[side], heroPowerSlot(p));
      put(this.decks[side], { ...deckSlot(p), rot: { x: 0, y: 0, z: 0 } });
      put(this.mana[side], manaSlot(p));
      L.heroes.add(this.heroes[side], this.heroPowers[side], this.decks[side], this.mana[side]);
    }
    put(this.endTurn, endTurnSlot());
    const far = heroSlot('far').pos;
    this.thinking.position.set(far.x - 3.2, 1.6, far.z);
    L.heroes.add(this.endTurn, this.thinking);
    L.top.add(this.arrow);
    this.shade.rotation.x = -CAMERA_PITCH;
    this.shade.position.set(0, 2.64, 3.02); // 离镜头 18：在起手牌（17.6）之后、我方枢纽（18.4）之前
    this.shade.renderOrder = 1;
    L.fx.add(this.shade);
    this.root.add(L.board, L.heroes, L.minions, L.handFar, L.fx, L.handNear, L.drag, L.top);
    this.particles = new ParticleSystem({ camera: stage.camera });
    this.root.add(this.particles.object);
    stage.scene.add(this.root);
    // 新的一局：镜头和调色回到默认（上一局的胜负演出可能改过）
    stage.cameraBase.set(CAMERA.pos.x, CAMERA.pos.y, CAMERA.pos.z);
    stage.cameraTarget.set(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);
    Object.assign(stage.look, { brightness: 0, saturation: 0, vignette: 0 });
    this.unhook = stage.onFrame((dt, t) => {
      this.particles.update(dt * gsap.globalTimeline.timeScale());
      if (this.frozen) return;
      // 能出的牌、能攻击的随从：绿色发光边按 1.6 秒一个周期脉动（m4-storyboard 第 2 节）。材质是共用的，全部一起脉动
      const pulse = 0.72 + 0.28 * Math.sin((t / 1.6) * Math.PI * 2);
      for (const [mat, base] of PULSE_BASE) mat.color.copy(base).multiplyScalar(pulse);
      this.board.tick(t);
      for (const h of this.heroes) h.tick(t);
      for (const m of this.mana) m.tick(t);
      this.endTurn.tick(t);
    });
    this.sync(view, 0);
    warmCombatFx(this); // 战斗特效（全屏泛红和白闪、枢纽裂纹）的着色器先在后台编译好
  }

  // 一盏投影的方向光加半球光（spec 5.4）。阴影贴图 2048，范围只罩住台面（spec 5.10）。
  readonly lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight } = {} as never;

  private addLights(): void {
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2a2418, 0.85);
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
    sun.position.set(-7, 16, 9);
    sun.target.position.set(0, 0, 0.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -13;
    cam.right = 13;
    cam.top = 11;
    cam.bottom = -11;
    cam.near = 4;
    cam.far = 40;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.root.add(hemi, sun, sun.target);
    Object.assign(this.lights, { hemi, sun });
  }

  // 一局结束：从舞台上拿走，释放这一局自己的几何体、材质、贴图（共用的不动）。
  dispose(): void {
    this.unhook();
    this.root.removeFromParent();
    // 粒子系统的资源归它自己放（releaseGpu 不认 ShaderMaterial 里的贴图），先摘下来
    this.particles.object.removeFromParent();
    this.particles.dispose();
    releaseGpu(this.root);
  }

  place(side: Side): Placement {
    return placementOf(side, this.view.viewer);
  }

  // ---------- 查询 ----------

  minion(id: number): MinionView | undefined {
    return this.minions.get(id);
  }

  // 一个目标当前在场景里的位置（台面上的点）。
  pointOf(ref: TargetRef): Point {
    if (ref.kind === 'hero') {
      const h = this.heroes[ref.side];
      return { x: h.position.x, y: 0.5, z: h.position.z };
    }
    const m = this.minions.get(ref.instanceId);
    if (m) return { x: m.position.x + m.body.position.x, y: 0.35 + m.body.position.y, z: m.position.z + m.body.position.z };
    const last = this.lastMinionPos.get(ref.instanceId);
    if (last) return last;
    return { ...boardSlot(this.place(ref.side), 0, 1).pos, y: 0.35 };
  }

  deckPoint(side: Side): Point {
    return above(deckSlot(this.place(side)).pos, 0.4);
  }

  heroPowerPoint(side: Side): Point {
    return above(heroPowerSlot(this.place(side)).pos, 0.3);
  }

  // 一个目标对应的物件（动画模块拿来抖动、闪光）。
  targetBody(ref: TargetRef): { body: THREE.Object3D; flash: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> } | null {
    if (ref.kind === 'hero') return this.heroes[ref.side];
    return this.minions.get(ref.instanceId) ?? null;
  }

  // 动画模块接管一张手牌（比如打出的牌飞到中央），之后 sync 不再管它，用完由接管方销毁。
  takeHandCard(id: number): CardView | null {
    const c = this.handCards.get(id);
    if (!c) return null;
    this.handCards.delete(id);
    if (this.draggingHand === id) this.draggingHand = null;
    this.layers.drag.add(c); // 各层都在原点，没有变换，直接换父物件不影响世界坐标
    return c;
  }

  // 新建一张不在手牌里的牌（爆牌、对手出牌的展示）。
  makeCard(instanceId: number, cardId: string, at: Slot): CardView {
    const c = new CardView(instanceId, cardId);
    put(c, at);
    this.layers.drag.add(c);
    return c;
  }

  // 左侧放大显示一张卡；stats 是场上随从的当前数值。cardId 为 null 时收起。
  showInspect(cardId: string | null, stats: CardStats | null = null): void {
    if (!cardId) {
      if (this.inspect) this.inspect.visible = false;
      return;
    }
    if (!this.inspect) {
      this.inspect = new CardView(-1, cardId);
      this.inspect.userData.pick = undefined; // 不参与拾取
      this.inspect.traverse((o) => (o.castShadow = false)); // 浮在镜头前的大卡不往棋盘上投影
      this.inspect.setMatte();
      this.layers.top.add(this.inspect);
    }
    const c = this.inspect;
    const wasHidden = !c.visible || c.cardId !== cardId;
    c.setCard(cardId);
    c.setStats(stats);
    c.visible = true;
    const s = inspectSlot();
    put(c, s);
    if (wasHidden) {
      c.scale.setScalar(s.scale * 0.85);
      gsap.to(c.scale, { x: s.scale, y: s.scale, z: s.scale, duration: 0.12, ease: 'back.out(2)', overwrite: 'auto' });
    }
  }

  // 放大卡左下角在画面（页面坐标）上的位置，关键词解释的 DOM 提示贴在它下面
  inspectAnchor(): { left: number; top: number; width: number } | null {
    if (!this.inspect?.visible) return null;
    const s = inspectSlot();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(s.rot.x, s.rot.y, s.rot.z)),
      new THREE.Vector3(s.scale, s.scale, s.scale),
    );
    const rect = this.stage.canvas.getBoundingClientRect();
    const toPage = (x: number, y: number) => {
      const p = new THREE.Vector3(x, y, 0).applyMatrix4(m).project(this.stage.camera);
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    };
    const bl = toPage(-CARD_W / 2, -CARD_H / 2);
    const br = toPage(CARD_W / 2, -CARD_H / 2);
    return { left: bl.x, top: bl.y, width: br.x - bl.x };
  }

  // ---------- 同步 ----------

  // 把场景对到显示局面。duration 为 0 时直接跳到位。返回有没有物件需要移动。
  markViews(views: readonly ViewState[], seq: number): void {
    for (const v of views) this.viewSeq.set(v, seq);
    this.newestSeq = Math.max(this.newestSeq, seq);
  }

  sync(view: ViewState, duration = LAYOUT_DURATION): boolean {
    const seq = this.viewSeq.get(view);
    if (seq !== undefined && seq < this.newestSeq) return false;
    this.view = view;
    this.shade.visible = view.phase === 'mulligan' && !this.intro;
    this.syncPotionCaption();
    let moved = false;
    for (const side of [0, 1] as Side[]) {
      const p = view.players[side];
      this.heroes[side].setHealth(p.hero.health, p.hero.maxHealth);
      this.heroes[side].setActive(view.phase === 'playing' && view.current === side);
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
  layoutHand(duration = 0.15, ease?: string): void {
    for (const side of [0, 1] as Side[]) this.syncHand(side, duration, ease);
  }

  // 只重排我方随从行（拖随从牌时空出位置）。
  layoutBoard(duration = 0.15, ease?: string): void {
    this.syncBoard(this.view.viewer, duration, ease);
  }

  // 换牌时法力药水下面写一行"后手补偿"，说明它为什么单独放着、为什么不能换
  private syncPotionCaption(): void {
    const v = this.view;
    const potion = v.phase === 'mulligan' && !this.intro && v.players[v.viewer].hand.some((c) => c.cardId === MANA_POTION_ID);
    if (!potion) {
      this.potionCaption?.removeFromParent();
      this.potionCaption?.dispose();
      this.potionCaption = null;
      return;
    }
    if (this.potionCaption) return;
    const rows = v.players[v.viewer].hand.filter((c) => c.cardId !== MANA_POTION_ID).length;
    const slot = mulliganPotionSlot(rows);
    const t = new Text();
    t.font = cardFontUrl();
    t.text = '后手补偿 · 不能换';
    t.fontSize = 0.26;
    t.anchorX = 'center';
    t.anchorY = 'middle';
    t.color = 0xf0e6d2;
    t.outlineWidth = '8%';
    t.outlineColor = 0x000000;
    // 写在药水上方：下方离镜头比压暗板远，会被压暗
    t.position.set(slot.pos.x, slot.pos.y + 1.55, slot.pos.z - 0.6);
    t.rotation.x = slot.rot.x;
    t.sync();
    this.potionCaption = t;
    this.layers.top.add(t);
  }

  // 一个点在画面上的左右位置，换成声像（-1 最左、1 最右，spec 5.7）。画面边上的不推到底，留一点
  panAt(p: { x: number; y: number; z: number }): number {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.stage.camera);
    return Math.max(-1, Math.min(1, v.x * 0.7));
  }

  // 一张我方手牌不悬停时该在的槽位（拖回手牌时的落点）
  handSlotOf(id: number): Slot | null {
    const hand = this.view.players[this.view.viewer].hand;
    const i = hand.findIndex((c) => c.instanceId === id);
    return i < 0 ? null : handSlot('near', i, hand.length);
  }

  private layerOf(p: Placement): THREE.Group {
    return p === 'near' ? this.layers.handNear : this.layers.handFar;
  }

  private syncHand(side: Side, duration: number, ease?: string): boolean {
    const p = this.place(side);
    const layer = this.layerOf(p);
    const hand = this.view.players[side].hand;
    const ids = new Set(hand.map((c) => c.instanceId));
    let moved = false;
    for (const [id, c] of this.handCards) {
      if (ids.has(id) || c.parent !== layer) continue;
      this.handCards.delete(id);
      fadeOutAndDispose(c);
    }
    const mulligan = this.view.phase === 'mulligan' && p === 'near';
    const visible = hand.filter((c) => c.instanceId !== this.draggingHand);
    // 换牌时法力药水单独放，其余起手牌按自己的张数排
    const rows = mulligan ? visible.filter((c) => c.cardId !== MANA_POTION_ID) : visible;
    const hoveredIndex = visible.findIndex((c) => c.instanceId === this.hoveredHand);
    visible.forEach((card, i) => {
      let c = this.handCards.get(card.instanceId);
      const spawned = !c;
      if (!c) {
        c = new CardView(card.instanceId, card.cardId);
        const from = this.handSpawn.get(card.instanceId);
        this.handSpawn.delete(card.instanceId);
        const deck = deckSlot(p);
        put(c, from ? { ...deck, pos: from } : { ...deck, pos: above(deck.pos, 0.6) });
        this.handCards.set(card.instanceId, c);
        layer.add(c);
      }
      c.setCard(card.cardId);
      c.setMarked(mulligan && this.mulliganMarks.has(card.instanceId));
      let slot: Slot;
      if (mulligan) slot = card.cardId === MANA_POTION_ID ? mulliganPotionSlot(rows.length) : mulliganSlot(rows.indexOf(card), rows.length);
      else if (p === 'near' && hoveredIndex >= 0) {
        slot = i === hoveredIndex ? handHoverSlot(i, visible.length) : handSlot(p, i, visible.length);
        if (i !== hoveredIndex) slot = { ...slot, pos: { ...slot.pos, x: slot.pos.x + handNeighborShift(i, hoveredIndex) } };
      } else slot = handSlot(p, i, visible.length);
      // 悬停的牌画在最上面（它离镜头最近，深度测试本来就对；renderOrder 只防同深度闪烁）
      c.renderOrder = i === hoveredIndex ? 2 : 0;
      if (this.returningHand.has(card.instanceId) || this.incomingHand.has(card.instanceId)) return;
      if (spawned && this.spawnAtSlot) {
        put(c, slot);
        return;
      }
      moved = moveTo(c, slot, duration, ease) || moved;
    });
    return moved;
  }

  private syncBoard(side: Side, duration: number, ease?: string): boolean {
    const p = this.place(side);
    const board = this.view.players[side].board;
    const ids = new Set(board.map((m) => m.instanceId));
    let moved = false;
    for (const [id, m] of this.minions) {
      if (m.side !== side || ids.has(id)) continue;
      this.minions.delete(id);
      this.lastMinionPos.set(id, { x: m.position.x, y: 0.35, z: m.position.z });
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
        this.layers.minions.add(m);
        if (this.heldSpawns.has(vm.instanceId)) {
          this.heldSpawns.delete(vm.instanceId);
          m.body.visible = false;
        } else if (duration > 0) {
          // 落地：从空中落下、压扁回弹
          m.body.position.y = 1.6;
          m.body.scale.set(0.6, 0.6, 0.6);
          gsap.to(m.body.position, { y: 0, duration: 0.3, ease: 'power3.in' });
          gsap.to(m.body.scale, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'back.out(2.5)' });
          moved = true;
        }
      }
      m.update(vm);
      moved = moveTo(m, slot, duration, ease) || moved;
    });
    return moved;
  }

  // ---------- 高亮 ----------

  // 合法操作的高亮。null 表示输入锁定，全部熄灭。
  setHighlights(h: LegalHighlights | null): void {
    this.highlights = h;
    this.endTurn.setMode(this.endTurnMode(), h?.endTurnReady ?? false);
    this.applyHighlights();
  }

  // 选目标时：合法目标红色高亮，其余变暗。null 表示退出选目标。
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
      if (c.parent !== this.layers.handNear || c.hidden) continue;
      c.setHighlight(!!h && h.playable.has(c.instanceId) && !this.targetMarks);
      c.setDim(v.phase === 'playing' && (findCard(c.cardId)?.cost ?? 0) > mana);
    }
    const marks = this.targetMarks;
    const isMarked = (ref: TargetRef) =>
      !!marks &&
      marks.targets.some((t) => t.side === ref.side && t.kind === ref.kind && (t.kind === 'hero' || (ref.kind === 'minion' && t.instanceId === ref.instanceId)));
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
