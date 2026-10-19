// 结束回合按钮（spec 5.2、5.4、5.6；m4-storyboard E02、E26）：海克斯风格的菱形实体按钮，和水晶枢纽方案 b 同一套材质：
// 暗色金属的六棱底座加一圈金色金属沿，上面一块带厚度和倒角的切角菱形面板，四周一圈凸起的金色金属框，框内一圈发光边。
// 面板朝镜头倾斜，绕自己的长轴翻转：正面写"结束回合"，背面写"对方回合"，字是 SDF 文本，贴在面板上跟着一起转。
// 状态：
// - mine：我方回合，还有别的事可做。金色发光边加面板微微自发光，缓慢脉动；
// - ready：我方回合，只剩结束回合可做。换成海克斯青色，更亮，脉动更快，提示该点了；
// - theirs：对方回合。面板翻到背面，发光边熄灭，不能点；
// - off：换牌阶段、对局结束。正面朝上，熄灭，字压暗。
// 悬停时抬起一点、变亮；按下时下压再回弹。亮度和脉动每帧算（tick），参数在 END_TURN，调试台 /dev/fx 可调。
import gsap from 'gsap';
import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { cardFontUrl } from '../assets/manifest';
import { glowMaterial, markBloom } from '../presentation/fx/materials';
import { shared } from './dispose';

export const END_TURN = {
  tilt: 0.35, // 面板朝镜头倾斜的角度（弧度）
  glow: 1.6, // 发光边亮度（HDR 倍数）
  face: 0.55, // 面板中心透出的光（相对发光边）。不进泛光，免得把字晕开
  pulse: 2.2, // 脉动周期（秒）
  pulseAmp: 0.25, // 脉动幅度
  readyGlow: 2.4, // 只剩结束回合时的亮度
  readyPulse: 0.9, // 只剩结束回合时的脉动周期
  hoverGlow: 0.35, // 悬停时额外加的亮度
  hoverLift: 0.08, // 悬停抬起的高度
  pressDepth: 0.07, // 按下的深度
  flip: 0.28, // 翻到对方回合的时长（E26 变暗 200ms 加翻转）
  fade: 0.15, // 亮度变化的平滑时间常数
};

export type EndTurnMode = 'mine' | 'theirs' | 'off';

const GOLD = 0xc8aa6e; // 海克斯金
const TEAL = 0x0ac8b9; // 海克斯青
const W = 2.5; // 面板宽（左右两个尖之间）
const D = 1.5; // 面板深（前后两个尖之间）
const T = 0.14; // 面板厚
const CHAMFER = 0.1; // 左右两个尖切成的竖边的半长

// 切角菱形（xy 平面，中心在原点）：左右两个尖切成竖直的短边，前后两个尖保留。k 是缩放
function diamond(k: number): THREE.Shape {
  const w = (W / 2) * k;
  const d = (D / 2) * k;
  const e = CHAMFER * k;
  const s = new THREE.Shape();
  s.moveTo(-w, -e);
  s.lineTo(-w, e);
  s.lineTo(0, d);
  s.lineTo(w, e);
  s.lineTo(w, -e);
  s.lineTo(0, -d);
  s.closePath();
  return s;
}

// 挤出后转到 xz 平面、厚度沿 y，居中在 y = 0
function slab(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

function ring(outer: number, inner: number): THREE.Shape {
  const s = diamond(outer);
  s.holes.push(diamond(inner) as unknown as THREE.Path);
  return s;
}

const panelGeo = shared(slab(diamond(1), T, 0.025));
const frameGeo = shared(slab(ring(1.07, 0.985), T + 0.05, 0.012));
const glowGeo = shared(new THREE.ShapeGeometry(ring(0.93, 0.895)).rotateX(-Math.PI / 2));
const baseGeo = shared(new THREE.CylinderGeometry(1.12, 1.26, 0.26, 6));
// 底座顶面外圈的金色窄沿：六边形环，和圆柱底座的朝向一致（前后是尖）
const lipGeo = shared((() => {
  const hex = (r: number) => {
    const p = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + (Math.PI / 3) * i;
      if (i === 0) p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else p.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    p.closePath();
    return p;
  };
  const outer = hex(1.15);
  outer.holes.push(hex(0.98) as unknown as THREE.Path);
  return slab(outer, 0.05, 0.01);
})());
const cradleGeo = shared(new THREE.BoxGeometry(1.3, 0.32, 0.5));

// 面板正面的自发光贴图：中心亮、往边上暗，像光从面板里面透出来。挤出几何体正面的 uv 就是形状坐标（单位长度），
// 用 repeat 和 offset 换算到 0 到 1
const faceGlow = shared((() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 64, 4, 128, 64, 120);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.45, '#7a7a7a');
  grad.addColorStop(1, '#000000');
  g.setTransform(1, 0, 0, 0.5, 0, 32); // 横向拉长的椭圆，贴合菱形
  g.fillStyle = grad;
  g.fillRect(0, -64, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / W, 1 / D);
  t.offset.set(0.5, 0.5);
  return t;
})());

// 和枢纽方案 b 同一套金属
const metalMat = shared(new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.45, metalness: 0.75, flatShading: true }));
const goldMat = shared(new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 0.85 }));

// 金色金属反射舞台的 reflections：没有反射环境时，金色只剩一块暗褐色，看不出是金属。
// 暗色底座不加：加了会被房间的灯照成浅褐色，和枢纽的暗金属对不上
export function useButtonReflections(env: THREE.Texture): void {
  for (const m of [goldMat]) {
    if (m.envMap === env) continue;
    m.envMap = env;
    m.envMapIntensity = 0.6;
    m.needsUpdate = true;
  }
}

function label(text: string, size: number): Text {
  const t = new Text();
  t.font = cardFontUrl();
  t.text = text;
  t.fontSize = size;
  t.letterSpacing = 0.06;
  t.anchorX = 'center';
  t.anchorY = 'middle';
  t.outlineWidth = '6%';
  t.outlineColor = 0x000000;
  t.sync();
  return t;
}

export class EndTurnButton extends THREE.Group {
  mode: EndTurnMode = 'off';
  private ready = false;
  private hovered = false;
  private level = 0; // 当前亮度（平滑过渡）
  private lastT: number | null = null;
  private readonly hinge = new THREE.Group(); // 倾斜
  private readonly lift = new THREE.Group(); // 悬停抬起、按下
  private readonly flipper = new THREE.Group(); // 翻面
  private readonly faceMat: THREE.MeshPhysicalMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly front: Text;
  private readonly back: Text;
  private flipTween: gsap.core.Tween | null = null;
  private hoverTween: gsap.core.Tween | null = null;
  private pressTl: gsap.core.Timeline | null = null;
  private pressing = false; // 正在往下压（E26 按下 80ms），翻面等它压到底再开始

  constructor() {
    super();
    const base = new THREE.Mesh(baseGeo, metalMat);
    base.position.y = 0.13;
    const lip = new THREE.Mesh(lipGeo, goldMat);
    lip.position.y = 0.27;
    // 托住面板的金属托架
    const cradle = new THREE.Mesh(cradleGeo, metalMat);
    cradle.position.y = 0.4;
    for (const m of [base, lip, cradle]) {
      m.scale.x = m === cradle ? 1 : 1.3; // 底座沿面板方向拉长一点
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.hinge.position.y = 0.62;
    this.hinge.rotation.x = END_TURN.tilt; // 正面朝镜头倾斜
    this.faceMat = new THREE.MeshPhysicalMaterial({
      color: 0x141a22,
      roughness: 0.35,
      metalness: 0.55,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
      emissive: GOLD,
      emissiveMap: faceGlow,
      emissiveIntensity: 0,
    });
    const panel = new THREE.Mesh(panelGeo, this.faceMat);
    panel.castShadow = true;
    const frame = new THREE.Mesh(frameGeo, goldMat);
    frame.castShadow = true;
    this.glowMat = glowMaterial(GOLD, 0);
    const glow = new THREE.Mesh(glowGeo, this.glowMat);
    glow.position.y = T / 2 + 0.026;
    markBloom(glow);
    this.front = label('结束回合', 0.34);
    this.front.rotation.x = -Math.PI / 2;
    this.front.position.y = T / 2 + 0.03;
    // 背面的字：面板绕 x 轴翻 180° 后，它朝上而且正着读
    this.back = label('对方回合', 0.3);
    this.back.rotation.x = Math.PI / 2;
    this.back.position.y = -(T / 2 + 0.03);
    this.back.color = 0x8d9aa6;
    this.flipper.add(panel, frame, glow, this.front, this.back);
    this.lift.add(this.flipper);
    this.hinge.add(this.lift);
    this.add(base, lip, cradle, this.hinge);
    this.userData.pick = { kind: 'end_turn' };
    this.applyText();
  }

  setMode(mode: EndTurnMode, ready: boolean): void {
    this.ready = mode === 'mine' && ready;
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    if (mode !== 'mine') this.setHover(false);
    const flipped = mode === 'theirs' ? Math.PI : 0;
    this.flipTween?.kill();
    if (prev === 'off' && mode !== 'theirs') this.flipper.rotation.x = flipped;
    else {
      // 翻到对方回合：E26 的"落"；翻回我方回合：E02 亮起时带一点回弹
      this.flipTween = gsap.to(this.flipper.rotation, {
        x: flipped,
        delay: this.pressing ? 0.08 : 0,
        duration: END_TURN.flip,
        ease: mode === 'theirs' ? 'power2.out' : 'back.out(1.4)',
      });
    }
    this.applyText();
  }

  private applyText(): void {
    this.front.color = this.mode === 'mine' ? 0xf0e6d2 : 0x6f6a60;
  }

  setHover(on: boolean): void {
    on = on && this.mode === 'mine';
    if (on === this.hovered) return;
    this.hovered = on;
    this.hoverTween?.kill();
    // 按下的回弹还在走时不插手：回弹的终点按回弹开始时的悬停状态算
    if (this.pressTl?.isActive()) return;
    this.hoverTween = gsap.to(this.lift.position, { y: on ? END_TURN.hoverLift : 0, duration: 0.15, ease: 'power2.out' });
  }

  // 按下：下压再回弹到悬停的高度（E26 按下 80ms 起）
  press(): void {
    this.hoverTween?.kill();
    this.pressTl?.kill();
    const t = gsap.timeline({ onInterrupt: () => (this.pressing = false) });
    this.pressing = true;
    t.to(this.lift.position, { y: -END_TURN.pressDepth, duration: 0.08, ease: 'power3.in', onComplete: () => (this.pressing = false) });
    t.to(this.lift.position, { y: () => (this.hovered ? END_TURN.hoverLift : 0), duration: 0.3, ease: 'back.out(2.5)' });
    this.pressTl = t;
  }

  // 每帧调，t 是秒
  tick(t: number): void {
    const P = END_TURN;
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.hinge.rotation.x = P.tilt;
    const mine = this.mode === 'mine';
    const period = this.ready ? P.readyPulse : P.pulse;
    const base = !mine ? 0 : (this.ready ? P.readyGlow : P.glow) + (this.hovered ? P.hoverGlow : 0);
    this.level += (base - this.level) * (1 - Math.exp(-dt / Math.max(0.01, P.fade)));
    const pulse = mine ? 1 + P.pulseAmp * Math.sin((t / period) * Math.PI * 2) : 1;
    const v = Math.max(0, this.level * pulse);
    const hex = this.ready ? TEAL : GOLD;
    this.glowMat.color.setHex(hex).multiplyScalar(v);
    this.faceMat.emissive.setHex(hex);
    this.faceMat.emissiveIntensity = v * P.face;
  }
}
