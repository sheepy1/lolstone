// 海克斯拱弧（目标箭头 arrow.ts、触发光线 beam.ts 共用的造型，m4-storyboard 第 2 节"目标箭头"、E08）：
// - 三次贝塞尔，两个控制点抬高，拱高随距离增加，越过中间的随从；第二个控制点靠近终点、低一些，末段朝下扎向目标。
// - 身体是朝镜头的能量带，由粗到细；着色器里画半透明的带子、中线亮芯和一节节朝目标流动的镂空菱形（uv 滚动）。
// - 头部是带金边和深色描边的海克斯箭头，正对镜头，指向取末端切线在画面上的方向。
// - 台面上顺着方向光投一道淡影，来源处冒一团光。
// ArcVisual 在构造时建好几何体，每次 draw 只改顶点数组，不新建对象。贴图和头部、光团的几何体是模块级共用的（shared）。
import * as THREE from 'three';
import { shared } from '../../scene/dispose';
import { hdr, markBloom } from './materials';

export type Ctrl = [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];

/** 造型参数。目标箭头用 ARROW，触发光线用 BEAM_STYLE。 */
export type ArcStyle = {
  glow: number; // 能量带和头部的 HDR 倍数
  archBase: number; // 拱高 = archBase + archPerUnit × 水平距离，最高 archMax（控制点的抬高；弧线最高点约为它的 0.75）
  archPerUnit: number;
  archMax: number;
  width0: number; // 能量带在来源端的宽度
  width1: number; // 能量带在头部端的宽度
  diamonds: number; // 每单位长度几节菱形
  flow: number; // 菱形朝目标流动的速度（节/秒）
  headLength: number;
  headWidth: number;
  shadow: number; // 台面投影的不透明度
  sourceGlow: number; // 来源光团的大小
};

export const SEGMENTS = 48;
// 投影：方向光每下降 1 单位，影子在水平面上移多少（太阳在 (-7, 16, 9)，见 table.ts 的 addLights）；影子贴着台面略高一点，
// 不被地形的细小起伏埋掉
const SUN_SLOPE = { x: 7 / 16, z: -9 / 16 };
const SHADOW_Y = 0.06;

export function newCtrl(): Ctrl {
  return [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
}

/** 弧线的四个控制点：起点、两个抬高的控制点、终点。 */
export function arcControls(a: THREE.Vector3, b: THREE.Vector3, out: Ctrl, style: ArcStyle): void {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const h = Math.min(style.archMax, style.archBase + style.archPerUnit * dist);
  const top = Math.max(a.y, b.y);
  out[0].copy(a);
  out[1].copy(a).lerp(b, 0.22);
  out[1].y = top + h;
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

export function bezierTangent(p: readonly THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
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

// ---------- 共用的贴图和几何体 ----------

export function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lazy<T>(make: () => T): () => T {
  let v: T | null = null;
  return () => (v ??= make());
}

const glowTex = lazy(() =>
  shared(
    canvasTexture(128, (g, s) => {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    }),
  ),
);

// 投影的横截面：中间深、两边透明
const shadowTex = lazy(() =>
  shared(
    canvasTexture(64, (g, s) => {
      const grad = g.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.3, 'rgba(0,0,0,1)');
      grad.addColorStop(0.7, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    }),
  ),
);

// 海克斯箭头的外形（局部坐标：y 朝前，尖端在 y = 1，宽 1）
const headGeo = lazy(() => {
  const s = new THREE.Shape();
  s.moveTo(0, 1);
  s.lineTo(0.5, 0.12);
  s.lineTo(0.2, 0.26);
  s.lineTo(0.12, 0);
  s.lineTo(-0.12, 0);
  s.lineTo(-0.2, 0.26);
  s.lineTo(-0.5, 0.12);
  s.closePath();
  return shared(new THREE.ShapeGeometry(s));
});

// 能量带：uv.x 是从来源量起的弧长（世界单位），uv.y 是横向 0 到 1。着色器里分三层：
// band 是带子本身（半透明、两边柔），core 是中线的亮芯，diamond 是一节节朝目标流动的菱形（每节里菱形占 72%，中间挖空，
// 像海克斯的镂空金属框）。reveal 是从来源量起画到弧长的几分之几（身体后补），opacity 整体淡出。
// 着色器字符串里不写中文注释：界面字体子集的扫描会把字符串里的字算进去。
function bodyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color() },
      time: { value: 0 },
      diamonds: { value: 1 },
      flow: { value: 1 },
      reveal: { value: 1 },
      length: { value: 1 },
      opacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float time, diamonds, flow, reveal, length, opacity;
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
        float a = max(max(band, core * 0.75), diamond) * startFade * opacity;
        if (a < 0.06) discard;
        vec3 c = color * (0.45 + 0.35 * core + 0.9 * diamond) + vec3(0.25) * diamond * (1.0 - hole);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function ribbonGeometry(): THREE.BufferGeometry {
  const n = (SEGMENTS + 1) * 2;
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
}

export type ArcDraw = {
  /** 来源点（光团的位置）。 */
  from: THREE.Vector3;
  /** 整条弧线的控制点。 */
  ctrl: Ctrl;
  /** 头部在弧线上的位置（0 到 1）。目标箭头恒为 1；触发光线从 0 走到 1。 */
  headT: number;
  /** 身体从来源画到弧长的几分之几（目标箭头开始时的"身体后补"），默认 1。 */
  bodyReveal?: number;
  /** 头部是否显示（目标箭头在身体长全之前不显示头部）。 */
  showHead?: boolean;
  /** 能量带、头部、光团的颜色（未乘亮度）。 */
  color: THREE.Color;
  /** 亮度系数（乘在 style.glow 上）；目标箭头指着非法目标时压暗。 */
  intensity: number;
  /** 头部金边的亮度。 */
  rim: number;
  /** 整体不透明度（触发光线淡出用）。 */
  alpha: number;
  /** 光团大小系数（1 为 style.sourceGlow）。 */
  glow: number;
  time: number;
  camera: THREE.Camera;
};

export class ArcVisual extends THREE.Group {
  private readonly body: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly head = new THREE.Group();
  private readonly headMats: THREE.MeshBasicMaterial[];
  private readonly headFill: THREE.MeshBasicMaterial;
  private readonly headRim: THREE.MeshBasicMaterial;
  private readonly glowSprite: THREE.Sprite;
  private readonly tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), r: new THREE.Vector3(), m: new THREE.Matrix4() };
  /** 头部尖端现在的位置（draw 之后有效）。 */
  readonly tip = new THREE.Vector3();

  constructor(readonly style: ArcStyle) {
    super();
    this.body = new THREE.Mesh(ribbonGeometry(), bodyMaterial());
    this.body.frustumCulled = false;
    markBloom(this.body);
    // 带子铺在地面上时三角形朝下，要双面
    this.shadow = new THREE.Mesh(
      ribbonGeometry(),
      new THREE.MeshBasicMaterial({ map: shadowTex(), color: 0x000000, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    // 头部三层：深色外描边、金边、发光的箭头本体。都不做深度测试、按 renderOrder 画在最上面：头部扎进目标时不被底座、
    // 准星挡住；所以不进泛光（泛光要写深度），自身用 HDR 颜色发亮
    const onTop = { side: THREE.DoubleSide, transparent: true, depthTest: false, toneMapped: false } as const;
    const dark = new THREE.MeshBasicMaterial({ color: 0x07090c, ...onTop });
    this.headRim = new THREE.MeshBasicMaterial({ color: new THREE.Color(), ...onTop });
    this.headFill = new THREE.MeshBasicMaterial({ color: new THREE.Color(), ...onTop });
    this.headMats = [dark, this.headRim, this.headFill];
    const layers: [THREE.MeshBasicMaterial, number, number][] = [
      [dark, 1.26, -0.12],
      [this.headRim, 1.12, -0.06],
      [this.headFill, 1, 0],
    ];
    layers.forEach(([mat, scale, y], i) => {
      const m = new THREE.Mesh(headGeo(), mat);
      m.scale.setScalar(scale);
      m.position.set(0, y, -0.004 + i * 0.002);
      m.renderOrder = 20 + i;
      this.head.add(m);
    });
    this.glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.glowSprite.renderOrder = 11;
    this.add(this.shadow, this.body, this.head, this.glowSprite);
  }

  draw(d: ArcDraw): void {
    const st = this.style;
    const { a, b, c } = this.tmp;
    const camPos = d.camera.position;
    bezier(d.ctrl, d.headT, this.tip);
    const chord = this.tip.distanceTo(d.from);
    const show = chord > 0.35;
    this.body.visible = show;
    this.shadow.visible = show;
    this.head.visible = show && d.showHead !== false;

    const bodyMat = this.body.material;
    const u = bodyMat.uniforms;
    (u.color!.value as THREE.Color).copy(d.color).multiplyScalar(st.glow * d.intensity);
    u.time!.value = d.time;
    u.diamonds!.value = st.diamonds;
    u.flow!.value = st.flow;
    u.reveal!.value = d.bodyReveal ?? 1;
    u.opacity!.value = d.alpha;
    this.headFill.color.copy(d.color).multiplyScalar(st.glow * d.intensity);
    this.headRim.color.setHex(0xe0b25e).multiplyScalar(d.rim);
    for (const m of this.headMats) m.opacity = d.alpha;
    this.shadow.material.opacity = st.shadow * d.alpha * (0.7 + 0.3 * Math.min(1, d.intensity));

    this.glowSprite.position.copy(d.from);
    this.glowSprite.scale.setScalar(st.sourceGlow * d.glow);
    this.glowSprite.material.color.copy(d.color).multiplyScalar(1.6 * d.intensity);
    this.glowSprite.material.opacity = d.alpha;
    if (!show) return;

    // 身体画到头部后端：沿弧长往回退半个头长（粗略按弦长估算参数）
    let approx = 0;
    for (let i = 1; i <= 8; i++) approx += bezier(d.ctrl, (d.headT * i) / 8, a).distanceTo(bezier(d.ctrl, (d.headT * (i - 1)) / 8, b));
    const tEnd = Math.max(0, d.headT * (1 - (st.headLength * 0.55) / Math.max(approx, 0.001)));

    const pos = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = this.body.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const spos = this.shadow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const suv = this.shadow.geometry.getAttribute('uv') as THREE.BufferAttribute;
    let arc = 0;
    const prev = this.tmp.r;
    for (let i = 0; i <= SEGMENTS; i++) {
      const k = i / SEGMENTS;
      const t = tEnd * k;
      const p = bezier(d.ctrl, t, a);
      const tan = bezierTangent(d.ctrl, t, b);
      if (i > 0) arc += p.distanceTo(prev);
      prev.copy(p);
      // 朝镜头的带子：横向 = 切线 × 视线
      const side = c.subVectors(camPos, p).cross(tan).normalize();
      const w = (st.width0 + (st.width1 - st.width0) * k) / 2;
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      uv.setXY(i * 2, arc, 0);
      uv.setXY(i * 2 + 1, arc, 1);
      // 投影：顺着方向光压到台面上，影子和弧线在画面上错开、看得出悬空；横向取水平面里垂直于切线的方向，越高越宽
      const hx = -tan.z;
      const hz = tan.x;
      const hl = Math.hypot(hx, hz) || 1;
      const sw = w * (1.1 + p.y * 0.25);
      const sx = p.x + p.y * SUN_SLOPE.x;
      const sz = p.z + p.y * SUN_SLOPE.z;
      spos.setXYZ(i * 2, sx + (hx / hl) * sw, SHADOW_Y, sz + (hz / hl) * sw);
      spos.setXYZ(i * 2 + 1, sx - (hx / hl) * sw, SHADOW_Y, sz - (hz / hl) * sw);
      suv.setXY(i * 2, k, 0);
      suv.setXY(i * 2 + 1, k, 1);
    }
    for (const attr of [pos, uv, spos, suv]) attr.needsUpdate = true;
    u.length!.value = arc;

    // 头部：尖端在 tip，正对镜头，指向取切线在画面上的方向（末段朝下时 3D 切线几乎顺着视线，按 3D 切线摆会被压扁成一小点）
    bezierTangent(d.ctrl, Math.max(0.001, d.headT), b);
    const toCam = c.subVectors(camPos, this.tip).normalize();
    b.addScaledVector(toCam, -b.dot(toCam));
    if (b.lengthSq() < 1e-6) b.set(0, 0, -1).addScaledVector(toCam, -toCam.z);
    b.normalize();
    const right = this.tmp.r.crossVectors(b, toCam);
    this.tmp.m.makeBasis(right, b, toCam);
    this.head.quaternion.setFromRotationMatrix(this.tmp.m);
    this.head.scale.set(st.headWidth, st.headLength, st.headWidth);
    this.head.position.copy(this.tip).addScaledVector(b, -st.headLength);
  }

  /** 释放自己的几何体和材质（共用的贴图、头部几何体不释放）。随场景销毁的（目标箭头）不用调，releaseGpu 会处理；用完就扔的（触发光线）要调。 */
  release(): void {
    this.body.geometry.dispose();
    this.body.material.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    for (const m of this.headMats) m.dispose();
    this.glowSprite.material.dispose();
  }
}
