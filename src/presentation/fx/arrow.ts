// 目标箭头（spec 5.3，m4-storyboard 第 2 节"目标箭头"）。攻击、指向法术、指向战吼、英雄技能选目标时，从来源拉出一条悬空的
// 3D 拱弧，海克斯风格：
// - 形状：三次贝塞尔，两个控制点抬高，拱高随距离增加，越过中间的随从。身体是一条朝镜头的能量带，由粗到细，带上一节节菱形
//   朝目标流动（uv 滚动）；头部是带金边的海克斯箭头；台面上投一道淡影，看得出它是悬空的。来源处冒一团光，像能量被拉出来。
// - 颜色按用途（arrowTone）：攻击和伤害红橙，增益和治疗金色，冻结冰蓝，其余默认红。
// - 合法目标：头部吸附到目标上，目标身上出现海克斯准星（和"选目标"鼠标指针同一个造型：金圈、四个刻度、中心菱形），
//   脉动，吸附时从大一圈回弹。非法目标和空地：箭头去色、变暗，不吸附；指着非法目标时头部加一个禁止标记。
// - 手感：头部用弹簧追目标点（参数和拖牌同一组，由调用方传入），身体在开始的 bodyLag 秒里从来源长出来（头部先到、身体后补）；
//   取消时头部沿弧线缩回来源再隐藏。
// 几何体在构造时一次建好，之后每帧只改顶点数组，不新建对象；整个箭头随场景销毁（releaseGpu）一起释放。
// 参数集中在 ARROW，/dev/fx 的"目标箭头"面板可调。
import * as THREE from 'three';
import type { CardDef, EffectAction } from '../../engine';
import type { Vec3 } from '../layout';
import { hdr, markBloom } from './materials';

export type Point = Vec3;

export type ArrowTone = 'damage' | 'buff' | 'frost' | 'default';

export const ARROW_COLORS: Record<ArrowTone, number> = {
  damage: 0xff4422,
  buff: 0xffc23a,
  frost: 0x64d2ff,
  default: 0xff3b3b,
};

export const ARROW = {
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

const SEGMENTS = 48;
// 投影：方向光每下降 1 单位，影子在水平面上移多少（太阳在 (-7, 16, 9)，见 table.ts 的 addLights）；影子贴着台面略高一点，
// 不被地形的细小起伏埋掉
const SUN_SLOPE = { x: 7 / 16, z: -9 / 16 };
const SHADOW_Y = 0.06;

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
export function arcControls(a: THREE.Vector3, b: THREE.Vector3, out: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]): void {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const h = Math.min(ARROW.archMax, ARROW.archBase + ARROW.archPerUnit * dist);
  const top = Math.max(a.y, b.y);
  out[0].copy(a);
  out[1].copy(a).lerp(b, 0.22);
  out[1].y = top + h;
  // 第二个控制点靠近终点、低一些：末段朝下扎向目标，头部斜着指进去
  out[2].copy(a).lerp(b, 0.9);
  out[2].y = top + h * 0.7;
  out[3].copy(b);
}

export function bezier(p: readonly THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  return out.set(
    p[0]!.x * k0 + p[1]!.x * k1 + p[2]!.x * k2 + p[3]!.x * k3,
    p[0]!.y * k0 + p[1]!.y * k1 + p[2]!.y * k2 + p[3]!.y * k3,
    p[0]!.z * k0 + p[1]!.z * k1 + p[2]!.z * k2 + p[3]!.z * k3,
  );
}

function bezierTangent(p: readonly THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  const k0 = -3 * u * u;
  const k1 = 3 * u * u - 6 * u * t;
  const k2 = 6 * u * t - 3 * t * t;
  const k3 = 3 * t * t;
  return out
    .set(
      p[0]!.x * k0 + p[1]!.x * k1 + p[2]!.x * k2 + p[3]!.x * k3,
      p[0]!.y * k0 + p[1]!.y * k1 + p[2]!.y * k2 + p[3]!.y * k3,
      p[0]!.z * k0 + p[1]!.z * k1 + p[2]!.z * k2 + p[3]!.z * k3,
    )
    .normalize();
}

// ---------- 贴图 ----------

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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

function drawGlow(g: CanvasRenderingContext2D, s: number): void {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
}

// 投影的横截面：中间深、两边透明
function drawShadow(g: CanvasRenderingContext2D, s: number): void {
  const grad = g.createLinearGradient(0, 0, 0, s);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.3, 'rgba(0,0,0,1)');
  grad.addColorStop(0.7, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
}

// ---------- 材质 ----------

// 能量带：uv.x 是从来源量起的弧长（世界单位），uv.y 是横向 0 到 1。着色器里分三层：
// band 是带子本身（半透明、两边柔），core 是中线的亮芯，diamond 是一节节朝目标流动的菱形（每节里菱形占 72%，中间挖空，
// 像海克斯的镂空金属框）。着色器字符串里不写中文注释：界面字体子集的扫描会把字符串里的字算进去。
function bodyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color() },
      time: { value: 0 },
      diamonds: { value: ARROW.diamonds },
      flow: { value: ARROW.flow },
      reveal: { value: 1 },
      length: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float time, diamonds, flow, reveal, length;
      varying vec2 vUv;
      void main() {
        float s = vUv.x / max(length, 0.001);
        if (s > reveal) discard;
        float across = abs(vUv.y - 0.5) * 2.0;
        float band = (1.0 - smoothstep(0.55, 1.0, across)) * 0.45;
        float core = 1.0 - smoothstep(0.0, 0.3, across);
        float f = fract(vUv.x * diamonds - time * flow);
        float d = abs(f - 0.5) * 2.0 / 0.72;
        float outer = 1.0 - smoothstep(0.86, 1.0, across + d);
        float hole = 1.0 - smoothstep(0.38, 0.5, across + d);
        float diamond = outer * (1.0 - hole * 0.75);
        float startFade = smoothstep(0.0, 0.07, s);
        float a = max(max(band, core * 0.75), diamond) * startFade;
        if (a < 0.06) discard;
        vec3 c = color * (0.45 + 0.35 * core + 0.9 * diamond) + vec3(0.25) * diamond * (1.0 - hole);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

// 海克斯箭头的外形（局部坐标：y 朝前，尖端在 y = 1）
function headShape(scale: number): THREE.Shape {
  const s = new THREE.Shape();
  const p = (x: number, y: number) => [x * scale, y * scale] as const;
  s.moveTo(...p(0, 1));
  s.lineTo(...p(0.5, 0.12));
  s.lineTo(...p(0.2, 0.26));
  s.lineTo(...p(0.12, 0));
  s.lineTo(...p(-0.12, 0));
  s.lineTo(...p(-0.2, 0.26));
  s.lineTo(...p(-0.5, 0.12));
  s.closePath();
  return s;
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

  private readonly ctrl: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  private readonly pts = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3());
  private readonly tans = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3());
  private readonly tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), r: new THREE.Vector3(), m: new THREE.Matrix4(), grey: new THREE.Color() };

  private readonly body: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly headGroup = new THREE.Group();
  private readonly headFill: THREE.MeshBasicMaterial;
  private readonly headRim: THREE.MeshBasicMaterial;
  private readonly reticle = new THREE.Group();
  private readonly reticleCore: THREE.MeshBasicMaterial;
  private readonly reticleGold: THREE.MeshBasicMaterial;
  private readonly forbid: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly glow: THREE.Sprite;

  constructor() {
    super();
    const n = (SEGMENTS + 1) * 2;
    const ribbon = (): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
      const idx: number[] = [];
      for (let i = 0; i < SEGMENTS; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(idx);
      return g;
    };
    this.body = new THREE.Mesh(ribbon(), bodyMaterial());
    this.body.frustumCulled = false;
    markBloom(this.body);
    this.shadow = new THREE.Mesh(
      ribbon(),
      new THREE.MeshBasicMaterial({ map: canvasTexture(64, drawShadow), color: 0x000000, transparent: true, opacity: ARROW.shadow, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;

    // 头部三层：深色外描边、金边、发光的箭头本体，前后错开一点避免闪烁
    const shape = headShape(1);
    const shapeGeo = new THREE.ShapeGeometry(shape);
    // 头部三层都不做深度测试、按 renderOrder 画在最上面：头部扎进目标时不被底座、准星挡住
    const onTop = { side: THREE.DoubleSide, transparent: true, depthTest: false } as const;
    const dark = new THREE.Mesh(shapeGeo, new THREE.MeshBasicMaterial({ color: 0x07090c, ...onTop }));
    dark.renderOrder = 20;
    dark.scale.setScalar(1.26);
    dark.position.set(0, -0.12, -0.004);
    this.headRim = new THREE.MeshBasicMaterial({ color: hdr(0xe0b25e, 1.5), toneMapped: false, ...onTop });
    const rim = new THREE.Mesh(shapeGeo, this.headRim);
    rim.renderOrder = 21;
    rim.scale.setScalar(1.12);
    rim.position.set(0, -0.06, -0.002);
    this.headFill = new THREE.MeshBasicMaterial({ color: new THREE.Color(), toneMapped: false, ...onTop });
    const fill = new THREE.Mesh(shapeGeo, this.headFill);
    fill.renderOrder = 22;
    this.headGroup.add(dark, rim, fill);

    // 准星：金圈和刻度一层（不染色），中心菱形一层（染成箭头颜色）
    const plane = new THREE.PlaneGeometry(1, 1);
    this.reticleGold = new THREE.MeshBasicMaterial({
      map: canvasTexture(256, (g, s) => drawReticle(g, s, 'gold')),
      color: hdr(0xffffff, 1.35),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.reticleCore = new THREE.MeshBasicMaterial({
      map: canvasTexture(256, (g, s) => drawReticle(g, s, 'core')),
      color: new THREE.Color(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const gold = new THREE.Mesh(plane, this.reticleGold);
    const core = new THREE.Mesh(plane, this.reticleCore);
    core.position.z = 0.01;
    // 准星不做深度测试、不进泛光（泛光要写深度），自身用 HDR 颜色发亮，压在目标上面；箭头头部再画在准星上面
    gold.renderOrder = 3;
    core.renderOrder = 4;
    this.reticle.add(gold, core);
    this.reticle.visible = false;

    this.forbid = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: canvasTexture(128, drawForbid), transparent: true, depthWrite: false, depthTest: false }));
    this.forbid.renderOrder = 23;
    this.forbid.visible = false;

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: canvasTexture(128, drawGlow), color: new THREE.Color(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.glow.renderOrder = 11;

    this.add(this.shadow, this.body, this.headGroup, this.reticle, this.forbid, this.glow);
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
    const snapped = state === 'target';
    if (snapped && (this.aimState !== 'target' || !this.reticleAt.equals(this.tmp.a.set(reticle!.at.x, reticle!.at.y, reticle!.at.z)))) this.snapAge = 0;
    this.aimState = state;
    this.goal.set(to.x, Math.max(to.y, 0.3) + (snapped ? 0.12 : 0.25), to.z);
    if (snapped && reticle) {
      this.reticleAt.set(reticle.at.x, reticle.at.y, reticle.at.z);
      this.reticleSize = reticle.size;
    }
    this.reticle.visible = snapped;
    this.forbid.visible = state === 'illegal';
  }

  /** 取消：头部沿弧线缩回来源，再隐藏。 */
  retract(): void {
    if (this.state !== 'aiming') return this.stop();
    this.state = 'retracting';
    this.retractT = 0;
    this.retractFrom.copy(this.head);
    this.reticle.visible = false;
    this.forbid.visible = false;
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
        const a = this.tmp.a.copy(this.head).sub(this.goal).multiplyScalar(-w * w).addScaledVector(this.vel, -2 * this.springDamping * w);
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

  private color(out: THREE.Color, intensity: number): THREE.Color {
    out.setHex(ARROW_COLORS[this.tone]);
    if (this.aimState !== 'target') {
      const l = out.r * 0.3 + out.g * 0.59 + out.b * 0.11;
      out.lerp(this.tmp.grey.setRGB(l, l, l), ARROW.grey);
      intensity *= ARROW.dim;
    }
    return out.multiplyScalar(intensity);
  }

  private rebuild(camera: THREE.Camera): void {
    const { a, b } = this.tmp;
    const len = this.head.distanceTo(this.from);
    const show = len > 0.35;
    this.body.visible = show;
    this.shadow.visible = show;
    this.headGroup.visible = show;
    const retracting = this.state === 'retracting';

    // 颜色
    const bodyMat = this.body.material;
    this.color(bodyMat.uniforms.color!.value as THREE.Color, ARROW.glow);
    bodyMat.uniforms.time!.value = this.time;
    bodyMat.uniforms.diamonds!.value = ARROW.diamonds;
    bodyMat.uniforms.flow!.value = ARROW.flow;
    bodyMat.uniforms.reveal!.value = retracting ? 1 : Math.min(1, this.age / Math.max(0.001, ARROW.bodyLag));
    this.color(this.headFill.color, ARROW.glow);
    this.headRim.color.setHex(0xe0b25e).multiplyScalar(this.aimState === 'target' ? 1.5 : 0.7);
    this.shadow.material.opacity = ARROW.shadow * (this.aimState === 'target' ? 1 : 0.7);

    // 来源光团：开始时猛亮一下，之后缓慢起伏
    const flare = Math.max(0, 1 - this.age / 0.3);
    const gs = ARROW.sourceGlow * (1 + 0.6 * flare + 0.08 * Math.sin(this.time * 7)) * (retracting ? 1 - Math.min(1, this.retractT) : 1);
    this.glow.position.copy(this.from);
    this.glow.scale.setScalar(gs);
    this.color(this.glow.material.color, 1.6 + flare);

    if (!show) {
      // 头部还没离开来源：准星、禁止标记都不显示（位置还没算，会停在上一次的地方）
      this.reticle.visible = false;
      this.forbid.visible = false;
      return;
    }
    this.reticle.visible = this.aimState === 'target' && !retracting;
    this.forbid.visible = this.aimState === 'illegal' && !retracting;

    // 弧线：终点是头部的后端（头部本身单独画），这样身体和头部接得上
    arcControls(this.from, this.head, this.ctrl);
    bezierTangent(this.ctrl, 1, b);
    const headLen = ARROW.headLength;
    const end = a.copy(this.head).addScaledVector(b, -headLen * 0.55);
    arcControls(this.from, end, this.ctrl);

    const pos = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = this.body.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const spos = this.shadow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const suv = this.shadow.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const camPos = camera.position;
    let arc = 0;
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const p = bezier(this.ctrl, t, this.pts[i]!);
      const tan = bezierTangent(this.ctrl, t, this.tans[i]!);
      if (i > 0) arc += p.distanceTo(this.pts[i - 1]!);
      // 朝镜头的带子：横向 = 切线 × 视线
      const side = this.tmp.c.subVectors(camPos, p).cross(tan).normalize();
      const w = (ARROW.width0 + (ARROW.width1 - ARROW.width0) * t) / 2;
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      uv.setXY(i * 2, arc, 0);
      uv.setXY(i * 2 + 1, arc, 1);
      // 投影：顺着方向光（table.ts 的太阳在 (-7, 16, 9)）压到台面上，所以影子和弧线在画面上错开、看得出悬空；
      // 横向取水平面里垂直于切线的方向，越高越宽
      const hx = -tan.z;
      const hz = tan.x;
      const hl = Math.hypot(hx, hz) || 1;
      const sw = w * (1.1 + p.y * 0.25);
      const sx = p.x + p.y * SUN_SLOPE.x;
      const sz = p.z + p.y * SUN_SLOPE.z;
      spos.setXYZ(i * 2, sx + (hx / hl) * sw, SHADOW_Y, sz + (hz / hl) * sw);
      spos.setXYZ(i * 2 + 1, sx - (hx / hl) * sw, SHADOW_Y, sz - (hz / hl) * sw);
      suv.setXY(i * 2, t, 0);
      suv.setXY(i * 2 + 1, t, 1);
    }
    for (const attr of [pos, uv, spos, suv]) attr.needsUpdate = true;
    bodyMat.uniforms.length!.value = arc;

    // 头部：尖端在 head，沿末端切线朝前，面朝镜头
    const reveal = bodyMat.uniforms.reveal!.value as number;
    this.headGroup.visible = reveal >= 1 || retracting;
    // 头部正对镜头，指向取末端切线在画面上的方向：末段朝下扎向目标时切线几乎顺着视线，按 3D 切线摆会被压扁成一小点
    bezierTangent(this.ctrl, 1, b);
    const toCam = this.tmp.c.subVectors(camPos, this.head).normalize();
    b.addScaledVector(toCam, -b.dot(toCam));
    if (b.lengthSq() < 1e-6) b.set(0, 0, -1).addScaledVector(toCam, -toCam.z);
    b.normalize();
    const right = this.tmp.r.crossVectors(b, toCam);
    this.tmp.m.makeBasis(right, b, toCam);
    this.headGroup.quaternion.setFromRotationMatrix(this.tmp.m);
    this.headGroup.scale.set(ARROW.headWidth, headLen, ARROW.headWidth);
    this.headGroup.position.copy(this.head).addScaledVector(b, -headLen);

    // 准星：在目标身上朝镜头，脉动，吸附时从大一圈回弹，缓慢转动
    if (this.reticle.visible) {
      const k = Math.min(1, this.snapAge / ARROW.snapTime);
      const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // back.out
      const snap = ARROW.snapScale + (1 - ARROW.snapScale) * back;
      const pulse = 1 + ARROW.pulseAmount * Math.sin((this.time / ARROW.pulse) * Math.PI * 2);
      this.reticle.position.copy(this.reticleAt);
      this.reticle.quaternion.copy(camera.quaternion);
      this.reticle.rotateZ(this.time * ARROW.spin);
      this.reticle.scale.setScalar(this.reticleSize * snap * pulse);
      this.color(this.reticleCore.color, 2.0 + 0.6 * Math.sin((this.time / ARROW.pulse) * Math.PI * 2));
    }
    if (this.forbid.visible) {
      this.forbid.position.copy(this.head).addScaledVector(toCam.copy(camPos).sub(this.head).normalize(), 0.3);
      this.forbid.quaternion.copy(camera.quaternion);
      this.forbid.scale.setScalar(0.62);
    }
  }
}
