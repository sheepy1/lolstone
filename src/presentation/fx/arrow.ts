// 目标箭头（spec 5.3，m4-storyboard 第 2 节"目标箭头"）。攻击、指向法术、指向战吼、英雄技能选目标时，从来源拉出一条悬空的
// 3D 拱弧，海克斯风格：
// - 形状：三次贝塞尔，两个控制点抬高，拱高随距离增加，越过中间的随从。身体是一条朝镜头的能量带，由粗到细，带上一节节菱形
//   朝目标流动（uv 滚动）；头部是带金边的海克斯箭头；台面上投一道淡影，看得出它是悬空的。来源处冒一团光，像能量被拉出来。
// - 颜色按用途（arrowTone）：攻击和伤害红橙，增益和治疗金色，冻结冰蓝，其余默认红。
// - 合法目标：头部吸附到目标上，目标身上出现海克斯准星（和"选目标"鼠标指针同一个造型：金圈、四个刻度、中心菱形），
//   脉动，吸附时从大一圈回弹。非法目标和空地：箭头去色、变暗，不吸附；指着非法目标时头部加一个禁止标记。
// - 手感：头部用弹簧追目标点（参数和拖牌同一组，由调用方传入），身体在开始的 bodyLag 秒里从来源长出来（头部先到、身体后补）；
//   取消时头部沿弧线缩回来源再隐藏。
// 拱弧、能量带、头部、投影、光团的造型在 arc.ts（触发光线 beam.ts 也用它），这里是瞄准的状态、准星和禁止标记。
// 几何体在构造时一次建好，之后每帧只改顶点数组，不新建对象；整个箭头随场景销毁（releaseGpu）一起释放。
// 参数集中在 ARROW，/dev/fx 的"目标箭头"面板可调。
import * as THREE from 'three';
import type { CardDef, EffectAction } from '../../engine';
import type { Vec3 } from '../layout';
import { arcControls as arcControlsWith, ArcVisual, bezier, canvasTexture, newCtrl, type ArcStyle, type Ctrl } from './arc';
import { hdr } from './materials';

export { bezier };

export type Point = Vec3;

export type ArrowTone = 'damage' | 'buff' | 'frost' | 'default';

export const ARROW_COLORS: Record<ArrowTone, number> = {
  damage: 0xff4422,
  buff: 0xffc23a,
  frost: 0x64d2ff,
  default: 0xff3b3b,
};

export const ARROW: ArcStyle & Record<string, number> = {
  glow: 2.4, // 能量带和头部的 HDR 倍数
  archBase: 1.3, // 拱高 = archBase + archPerUnit × 距离，最高 archMax（控制点的抬高；弧线最高点约为它的 0.75）
  archPerUnit: 0.32,
  archMax: 4,
  sourceLift: 0.15, // 起点比来源抬高多少
  width0: 0.42, // 能量带在来源端的宽度
  width1: 0.22, // 能量带在头部端的宽度
  diamonds: 1.25, // 每单位长度几节菱形
  flow: 1.8, // 菱形朝目标流动的速度（节/秒）
  headLength: 0.85,
  headWidth: 0.8,
  bodyLag: 0.15, // 身体从来源长到头部的时长（秒）
  pulse: 0.8, // 准星脉动周期（秒）
  pulseAmount: 0.07,
  snapScale: 1.4, // 吸附瞬间准星从多大回弹到 1
  snapTime: 0.26,
  reticleMinion: 1.95, // 准星直径（世界单位）：随从、英雄头像
  reticleHero: 1.7,
  spin: 0.5, // 准星缓慢转动（弧度/秒）
  dim: 0.3, // 非法目标、空地时的亮度
  grey: 0.75, // 非法目标、空地时去色的程度
  retractTime: 0.2, // 取消时缩回来源的时长（秒）
  shadow: 0.6, // 台面投影的不透明度
  sourceGlow: 0.8, // 来源光团的大小
};

/** 一次瞄准的用途决定箭头颜色。attack：随从攻击；否则看卡牌效果里作用在"选中目标"上的第一个动作。 */
export function arrowTone(kind: 'attack' | 'card', def: CardDef | null): ArrowTone {
  if (kind === 'attack') return 'damage';
  const actions: EffectAction[] = [];
  for (const e of def?.effects ?? []) {
    if (e.trigger === 'static') continue;
    for (const a of e.actions) if ('target' in a && a.target === 'chosen') actions.push(a);
  }
  const a = actions[0];
  if (!a) return 'default';
  if (a.kind === 'freeze' || ('fx' in a && a.fx === 'frost' && a.kind !== 'damage')) return 'frost';
  if (a.kind === 'buff' || a.kind === 'heal') return 'buff';
  if (a.kind === 'damage' || a.kind === 'destroy') return a.fx === 'frost' ? 'frost' : 'damage';
  return 'default';
}

/** 箭头弧线的四个控制点（三次贝塞尔）：起点、两个抬高的控制点、终点。 */
export function arcControls(a: THREE.Vector3, b: THREE.Vector3, out: Ctrl, style: ArcStyle = ARROW): void {
  arcControlsWith(a, b, out, style);
}

// ---------- 准星、禁止标记 ----------

// 准星：和 public/cursors/target.svg 同一个造型（金色圈、四个刻度、中心菱形），中心菱形用白色，由材质染成箭头的颜色
function drawReticle(g: CanvasRenderingContext2D, s: number, part: 'gold' | 'core'): void {
  const k = s / 32;
  g.scale(k, k);
  g.lineCap = 'square';
  if (part === 'gold') {
    g.strokeStyle = 'rgba(4,7,11,0.9)';
    g.lineWidth = 3.4;
    g.beginPath();
    g.arc(16, 16, 10, 0, Math.PI * 2);
    g.stroke();
    for (const [x1, y1, x2, y2] of [[16, 1.8, 16, 7], [16, 25, 16, 30.2], [1.8, 16, 7, 16], [25, 16, 30.2, 16]] as const) {
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    const grad = g.createLinearGradient(6, 6, 22, 28);
    grad.addColorStop(0, '#fff2c8');
    grad.addColorStop(0.45, '#e0b25e');
    grad.addColorStop(1, '#8c6428');
    g.strokeStyle = grad;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(16, 16, 10, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#ffe3a0';
    for (const [x1, y1, x2, y2] of [[16, 2, 16, 7.2], [16, 24.8, 16, 30], [2, 16, 7.2, 16], [24.8, 16, 30, 16]] as const) {
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    return;
  }
  g.fillStyle = 'rgba(4,7,11,0.9)';
  g.beginPath();
  g.moveTo(16, 11.4);
  g.lineTo(20.6, 16);
  g.lineTo(16, 20.6);
  g.lineTo(11.4, 16);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(16, 12.8);
  g.lineTo(19.2, 16);
  g.lineTo(16, 19.2);
  g.lineTo(12.8, 16);
  g.closePath();
  g.fill();
}

// 禁止标记：深色圆底、灰白圈加一道斜杠
function drawForbid(g: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  g.fillStyle = 'rgba(10,12,16,0.75)';
  g.beginPath();
  g.arc(c, c, s * 0.46, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d8d4cc';
  g.lineWidth = s * 0.09;
  g.beginPath();
  g.arc(c, c, s * 0.33, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(c - s * 0.23, c + s * 0.23);
  g.lineTo(c + s * 0.23, c - s * 0.23);
  g.stroke();
}

type State = 'hidden' | 'aiming' | 'retracting';
export type AimState = 'target' | 'free' | 'illegal';

export class TargetArrow extends THREE.Group {
  private state: State = 'hidden';
  private aimState: AimState = 'free';
  private tone: ArrowTone = 'default';
  private readonly from = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private springHz = 6;
  private springDamping = 0.7;
  private time = 0;
  private age = 0;
  private retractT = 0;
  private readonly retractFrom = new THREE.Vector3();
  private reticleSize = 0;
  private snapAge = 99;
  private readonly reticleAt = new THREE.Vector3();
  private readonly ctrl = newCtrl();
  private readonly color = new THREE.Color();
  private readonly grey = new THREE.Color();
  private readonly acc = new THREE.Vector3();

  private readonly arc = new ArcVisual(ARROW);
  private readonly reticle = new THREE.Group();
  private readonly reticleCore: THREE.MeshBasicMaterial;
  private readonly forbid: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    super();
    // 准星：金圈和刻度一层（不染色），中心菱形一层（染成箭头颜色）。不做深度测试、不进泛光（泛光要写深度），
    // 自身用 HDR 颜色发亮，压在目标上面；箭头头部再画在准星上面
    const plane = new THREE.PlaneGeometry(1, 1);
    const reticleMat = (part: 'gold' | 'core', color: THREE.Color) =>
      new THREE.MeshBasicMaterial({
        map: canvasTexture(256, (g, s) => drawReticle(g, s, part)),
        color,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      });
    this.reticleCore = reticleMat('core', new THREE.Color());
    const gold = new THREE.Mesh(plane, reticleMat('gold', hdr(0xffffff, 1.35)));
    const core = new THREE.Mesh(plane, this.reticleCore);
    gold.renderOrder = 3;
    core.renderOrder = 4;
    this.reticle.add(gold, core);
    this.reticle.visible = false;

    this.forbid = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: canvasTexture(128, drawForbid), transparent: true, depthWrite: false, depthTest: false }));
    this.forbid.renderOrder = 23;
    this.forbid.visible = false;

    this.add(this.arc, this.reticle, this.forbid);
    this.visible = false;
  }

  /** 开始瞄准。spring 是头部跟随的弹簧（和拖牌同一组参数）。 */
  start(from: Point, tone: ArrowTone, spring: { frequency: number; damping: number }): void {
    this.from.set(from.x, from.y + ARROW.sourceLift, from.z);
    this.head.copy(this.from);
    this.goal.copy(this.from);
    this.vel.set(0, 0, 0);
    this.tone = tone;
    this.springHz = spring.frequency;
    this.springDamping = spring.damping;
    this.state = 'aiming';
    this.aimState = 'free';
    this.age = 0;
    this.snapAge = 99;
    this.reticle.visible = false;
    this.forbid.visible = false;
    this.visible = true;
  }

  /**
   * 指向哪里。target：合法目标，头部吸附到 to，目标身上出现准星（reticle 给出准星中心和直径）；free：空地；
   * illegal：指着不能选的东西（头部加禁止标记）。后两种箭头去色变暗。
   */
  aimAt(to: Point, state: AimState, reticle?: { at: Point; size: number }): void {
    if (this.state !== 'aiming') return;
    const snapped = state === 'target' && !!reticle;
    if (snapped && (this.aimState !== 'target' || !this.reticleAt.equals(this.acc.set(reticle.at.x, reticle.at.y, reticle.at.z)))) this.snapAge = 0;
    this.aimState = state;
    this.goal.set(to.x, Math.max(to.y, 0.3) + (snapped ? 0.12 : 0.25), to.z);
    if (snapped) {
      this.reticleAt.set(reticle.at.x, reticle.at.y, reticle.at.z);
      this.reticleSize = reticle.size;
    }
  }

  /** 取消：头部沿弧线缩回来源，再隐藏。 */
  retract(): void {
    if (this.state !== 'aiming') return this.stop();
    this.state = 'retracting';
    this.retractT = 0;
    this.retractFrom.copy(this.head);
  }

  /** 确认（攻击、出牌开始）：立即隐藏，后续由动画接手。 */
  stop(): void {
    this.state = 'hidden';
    this.visible = false;
  }

  get active(): boolean {
    return this.state !== 'hidden';
  }

  /** 每帧调：弹簧、流动、脉动、重建顶点。 */
  tick(dt: number, camera: THREE.Camera): void {
    if (this.state === 'hidden') return;
    this.time += dt;
    this.age += dt;
    this.snapAge += dt;
    if (this.state === 'aiming') {
      // 半隐式欧拉，按 1/120 秒分步，和拖牌的弹簧一样
      const w = 2 * Math.PI * this.springHz;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = this.acc.copy(this.head).sub(this.goal).multiplyScalar(-w * w).addScaledVector(this.vel, -2 * this.springDamping * w);
        this.vel.addScaledVector(a, h);
        this.head.addScaledVector(this.vel, h);
      }
    } else {
      this.retractT += dt / ARROW.retractTime;
      const k = Math.min(1, this.retractT);
      this.head.lerpVectors(this.retractFrom, this.from, k * k);
      if (k >= 1) return this.stop();
    }
    this.rebuild(camera);
  }

  // 箭头颜色：指着合法目标时是用途色，否则去色
  private toneColor(out: THREE.Color): THREE.Color {
    out.setHex(ARROW_COLORS[this.tone]);
    if (this.aimState !== 'target') {
      const l = out.r * 0.3 + out.g * 0.59 + out.b * 0.11;
      out.lerp(this.grey.setRGB(l, l, l), ARROW.grey);
    }
    return out;
  }

  private rebuild(camera: THREE.Camera): void {
    const retracting = this.state === 'retracting';
    const onTarget = this.aimState === 'target';
    const reveal = retracting ? 1 : Math.min(1, this.age / Math.max(0.001, ARROW.bodyLag));
    arcControls(this.from, this.head, this.ctrl);
    // 来源光团：开始时猛亮一下，之后缓慢起伏；缩回时跟着变小
    const flare = Math.max(0, 1 - this.age / 0.3);
    const glow = (1 + 0.6 * flare + 0.08 * Math.sin(this.time * 7)) * (retracting ? 1 - Math.min(1, this.retractT) : 1);
    this.arc.draw({
      from: this.from,
      ctrl: this.ctrl,
      headT: 1,
      bodyReveal: reveal,
      showHead: reveal >= 1 || retracting,
      color: this.toneColor(this.color),
      intensity: onTarget ? 1 : ARROW.dim,
      rim: onTarget ? 1.5 : 0.7,
      alpha: 1,
      glow,
      time: this.time,
      camera,
    });
    const show = this.head.distanceTo(this.from) > 0.35;
    // 头部还没离开来源时，准星、禁止标记都不显示
    this.reticle.visible = show && onTarget && !retracting;
    this.forbid.visible = show && this.aimState === 'illegal' && !retracting;

    // 准星：在目标身上朝镜头，脉动，吸附时从大一圈回弹，缓慢转动
    if (this.reticle.visible) {
      const k = Math.min(1, this.snapAge / ARROW.snapTime);
      const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // back.out
      const snap = ARROW.snapScale + (1 - ARROW.snapScale) * back;
      const wave = Math.sin((this.time / ARROW.pulse) * Math.PI * 2);
      this.reticle.position.copy(this.reticleAt);
      this.reticle.quaternion.copy(camera.quaternion);
      this.reticle.rotateZ(this.time * ARROW.spin);
      this.reticle.scale.setScalar(this.reticleSize * snap * (1 + ARROW.pulseAmount * wave));
      this.reticleCore.color.setHex(ARROW_COLORS[this.tone]).multiplyScalar(2.0 + 0.6 * wave);
    }
    if (this.forbid.visible) {
      const tip = this.arc.tip;
      this.forbid.position.copy(tip).addScaledVector(this.acc.subVectors(camera.position, tip).normalize(), 0.3);
      this.forbid.quaternion.copy(camera.quaternion);
      this.forbid.scale.setScalar(0.62);
    }
  }
}
