// 回合流程用的画面件（m4-storyboard E01、E02、E03、E26、E28、E29）：
// - 横幅：镜头前一条暗色带子，上下两道金线，中间 SDF 大字，滑入时一道光扫过去；
// - 先后手徽记：一枚金色六边形徽章，翻转后停在"先手"或"后手"；
// - 从牌库飞进手牌的弧线飞行，飞到 40% 到 70% 之间绕长轴翻面；
// - 震屏 S1、S2、S3（分镜 1.4：相机位置叠加衰减噪声）。
// 战斗手感那一路也会用震屏；这里的实现只给回合流程和胜负用，参数照分镜表。
import gsap from 'gsap';
import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { cardFontUrl } from '../../assets/manifest';
import type { CardView } from '../../scene/cardView';
import type { Stage } from '../../scene/stage';
import { shared } from '../../scene/dispose';
import { glowMaterial, markBloom } from './materials';

export type Vec3 = { x: number; y: number; z: number };

// 调试台可调的参数
export const FLOW = {
  bannerIn: 0.25, // E02 滑入
  bannerHold: 0.5, // E02 停顿（给玩家读字，不要缩）
  bannerOut: 0.25, // E02 滑出
  bannerRise: 1.05, // 滑入的起点在中央上方多远（约 10% 画面高）
  drawLift: 0.08, // E03 起牌
  drawFly: 0.3, // E03 飞行
  drawSettle: 0.12, // E03 落位
};

const HEX_GOLD = 0xc8aa6e;
const CREAM = 0xf0e6d2;

// 镜头的"上"方向：横幅沿它滑入滑出
function cameraUp(stage: Stage): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(stage.camera.quaternion);
}

function sdf(text: string, size: number, color: number): Text {
  const t = new Text();
  t.font = cardFontUrl();
  t.text = text;
  t.fontSize = size;
  t.anchorX = 'center';
  t.anchorY = 'middle';
  t.color = color;
  t.outlineWidth = '5%';
  t.outlineColor = 0x000000;
  t.sync();
  return t;
}

// 横幅底板：横向两头渐隐的暗色带子
const bandTex = shared((() => {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(6,12,20,0)');
  grad.addColorStop(0.2, 'rgba(6,12,20,0.88)');
  grad.addColorStop(0.8, 'rgba(6,12,20,0.88)');
  grad.addColorStop(1, 'rgba(6,12,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})());
// 金线：两头渐隐
const lineTex = shared((() => {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.3, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 4);
  return new THREE.CanvasTexture(c);
})());
// 光扫：竖直的一道柔光
const sweepTex = shared((() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 8);
  return new THREE.CanvasTexture(c);
})());
const planeGeo = shared(new THREE.PlaneGeometry(1, 1));

export type BannerStyle = { color: number; line: number; scale: number };
export const WARM: BannerStyle = { color: 0xffe08a, line: HEX_GOLD, scale: 1 };
// 对方回合：冷色、略小（E26）
export const COLD: BannerStyle = { color: 0xcfe0f5, line: 0x7fa6c8, scale: 0.85 };

// 一条横幅。返回的时间线只包含滑入和停顿；滑出在 out() 里，调用方决定是不是让它和后面的事件重叠
export class Banner {
  readonly group = new THREE.Group();
  private readonly mats: THREE.Material[] = [];
  private readonly text: Text;
  private readonly sweep: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly st = { rise: 0, alpha: 0, scale: 1, sweep: -1 };

  constructor(
    private readonly stage: Stage,
    layer: THREE.Object3D,
    private readonly center: Vec3,
    label: string,
    style: BannerStyle,
  ) {
    const W = 7.5;
    const H = 1.25;
    const band = new THREE.Mesh(planeGeo, this.mat(new THREE.MeshBasicMaterial({ map: bandTex, transparent: true, depthWrite: false, depthTest: false })));
    band.scale.set(W, H, 1);
    const lineMat = this.mat(new THREE.MeshBasicMaterial({ map: lineTex, color: style.line, transparent: true, depthWrite: false, depthTest: false }));
    const top = new THREE.Mesh(planeGeo, lineMat);
    top.scale.set(W * 0.8, 0.035, 1);
    top.position.y = H / 2 - 0.05;
    const bottom = top.clone();
    bottom.position.y = -H / 2 + 0.05;
    this.sweep = new THREE.Mesh(
      planeGeo,
      this.mat(new THREE.MeshBasicMaterial({ map: sweepTex, color: 0xfff6d8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })) as THREE.MeshBasicMaterial,
    );
    this.sweep.scale.set(0.9, H * 0.9, 1);
    this.sweep.rotation.z = -0.25;
    this.text = sdf(label, 0.72, style.color);
    this.text.letterSpacing = 0.12;
    this.text.position.z = 0.01;
    (this.text.material as THREE.Material).depthTest = false;
    for (const [i, o] of [band, top, bottom, this.sweep, this.text].entries()) o.renderOrder = 50 + i;
    this.group.add(band, top, bottom, this.sweep, this.text);
    this.group.scale.setScalar(style.scale);
    this.group.visible = false;
    layer.add(this.group);
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private apply = (): void => {
    const up = cameraUp(this.stage).multiplyScalar(this.st.rise);
    this.group.position.set(this.center.x + up.x, this.center.y + up.y, this.center.z + up.z);
    this.group.quaternion.copy(this.stage.camera.quaternion);
    const k = this.st.scale;
    this.group.scale.setScalar(k * (this.group.userData.base ?? 1));
    for (const m of this.mats) m.opacity = this.st.alpha;
    this.text.fillOpacity = this.st.alpha;
    this.text.outlineOpacity = this.st.alpha;
    this.sweep.position.x = this.st.sweep * 4;
    this.sweep.material.opacity = this.st.alpha * Math.max(0, 1 - Math.abs(this.st.sweep));
  };

  // 滑入（落）：从中央上方滑到中央，缩放 0.9 到 1，光扫一遍；然后停顿
  in(duration = FLOW.bannerIn, hold = FLOW.bannerHold): gsap.core.Timeline {
    const t = gsap.timeline();
    t.call(() => {
      this.group.userData.base = this.group.scale.x;
      this.group.visible = true;
      Object.assign(this.st, { rise: FLOW.bannerRise, alpha: 0, scale: 0.9, sweep: -1 });
      this.apply();
    });
    t.to(this.st, { rise: 0, alpha: 1, scale: 1, duration, ease: 'power2.out', onUpdate: this.apply });
    t.to(this.st, { sweep: 1, duration: duration + 0.2, ease: 'none', onUpdate: this.apply }, '<');
    t.to({}, { duration: hold }, duration);
    return t;
  }

  // 滑出（起）：向上滑出并淡出，然后销毁
  out(duration = FLOW.bannerOut): gsap.core.Timeline {
    const t = gsap.timeline();
    t.to(this.st, { rise: FLOW.bannerRise, alpha: 0, duration, ease: 'power3.in', onUpdate: this.apply });
    t.call(() => this.dispose());
    return t;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.text.dispose();
  }
}

const coinGeo = shared(new THREE.CylinderGeometry(1, 1, 0.16, 6).rotateX(Math.PI / 2));
const coinRimGeo = shared(new THREE.TorusGeometry(1.02, 0.07, 6, 6));
const coinMat = shared(new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.4, metalness: 0.8, flatShading: true }));
const coinGoldMat = shared(new THREE.MeshStandardMaterial({ color: HEX_GOLD, roughness: 0.28, metalness: 0.9, flatShading: true }));

// 先后手徽记（E01）：暗金属六边形徽章，金边，正面写"先手"或"后手"，背面是素面。翻转若干圈后停在正面。
export class Emblem {
  readonly group = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly label: Text;
  private readonly glow: THREE.Mesh;

  constructor(
    private readonly stage: Stage,
    layer: THREE.Object3D,
    private readonly center: Vec3,
    text: string,
    env: THREE.Texture | null,
  ) {
    if (env && coinGoldMat.envMap !== env) {
      coinGoldMat.envMap = env;
      coinGoldMat.envMapIntensity = 0.7;
      coinGoldMat.needsUpdate = true;
    }
    const body = new THREE.Mesh(coinGeo, coinMat);
    const rim = new THREE.Mesh(coinRimGeo, coinGoldMat);
    rim.rotation.z = Math.PI / 6;
    this.label = sdf(text, 0.5, CREAM);
    this.label.letterSpacing = 0.1;
    this.label.position.z = 0.09;
    // 正面后面一圈金色光晕，进泛光
    this.glow = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.025, 6, 6), glowMaterial(0xffd58a, 1.6));
    this.glow.rotation.z = Math.PI / 6;
    markBloom(this.glow);
    this.spin.add(body, rim, this.label, this.glow);
    this.group.add(this.spin);
    this.group.visible = false;
    layer.add(this.group);
  }

  private place(): void {
    this.group.position.set(this.center.x, this.center.y, this.center.z);
    this.group.quaternion.copy(this.stage.camera.quaternion);
  }

  // 翻转（飘）：从小放大出现，绕竖轴转两圈半停在正面
  flip(duration: number): gsap.core.Timeline {
    const t = gsap.timeline();
    t.call(() => {
      this.place();
      this.group.visible = true;
      this.group.scale.setScalar(0.3);
      this.spin.rotation.y = -Math.PI * 5;
    });
    t.to(this.group.scale, { x: 1, y: 1, z: 1, duration: duration * 0.5, ease: 'back.out(1.4)' });
    t.to(this.spin.rotation, { y: 0, duration, ease: 'power2.out' }, 0);
    return t;
  }

  // 淡出（飘的消失段）：缩小、上浮，然后销毁
  out(duration: number): gsap.core.Timeline {
    const t = gsap.timeline();
    t.to(this.group.scale, { x: 0.01, y: 0.01, z: 0.01, duration, ease: 'power1.in' });
    t.to(this.group.position, { y: `+=0.4`, duration, ease: 'power1.in' }, 0);
    t.call(() => this.dispose());
    return t;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.label.dispose();
    (this.glow.material as THREE.Material).dispose();
    this.glow.geometry.dispose();
  }
}

// 一张牌从牌库飞到它现在的位置（E03 的起牌、飞行、落位）。调用前牌已经由 sync 放在目标槽位上：
// 先记下目标，马上挪回牌库顶，再沿拱起的弧线飞回来；flip 为 true 时起飞时背面朝上，在 40% 到 70% 之间绕长轴翻到正面。
// onFlip 在翻面中点调（翻牌声）。返回的时间线时长 = 起牌 + 飞行 + 落位。
export function flyFromDeck(card: CardView, deck: Vec3, opts: { flip: boolean; onFlip?: () => void; lift?: number }): gsap.core.Timeline {
  const t = gsap.timeline();
  const P = FLOW;
  const target = { pos: card.position.clone(), rot: card.rotation.clone(), scale: card.scale.x };
  const from = new THREE.Vector3(deck.x, deck.y, deck.z);
  const st = { k: 0, flip: opts.flip ? 1 : 0 };
  const curve = new THREE.QuadraticBezierCurve3(from.clone(), from.clone(), target.pos.clone());
  const apply = () => {
    card.position.copy(curve.getPoint(st.k));
    const k = st.k;
    card.rotation.set(target.rot.x * k + -Math.PI / 2 * (1 - k), target.rot.y + st.flip * Math.PI, target.rot.z * k);
    card.scale.setScalar(0.75 + (target.scale - 0.75) * k);
  };
  // 马上挪回牌库顶（不等时间线开始）：错开起飞的牌在等待时叠在牌库上，不会先在目标位置闪一下
  gsap.killTweensOf([card.position, card.rotation, card.scale]);
  apply();
  // 起牌（起）：牌库顶抬起 0.5 卡高
  const lift = opts.lift ?? 1.05;
  t.to(card.position, { y: deck.y + lift, duration: P.drawLift, ease: 'power3.in' });
  // 飞行（落）：弧线飞到目标
  t.call(() => {
    const start = card.position.clone();
    const mid = start.clone().lerp(target.pos, 0.5);
    mid.y = Math.max(start.y, target.pos.y) + 1.2;
    curve.v0.copy(start);
    curve.v1.copy(mid);
    curve.v2.copy(target.pos);
  });
  t.to(st, { k: 1, duration: P.drawFly, ease: 'power2.out', onUpdate: apply });
  if (opts.flip) {
    t.to(st, { flip: 0, duration: P.drawFly * 0.3, ease: 'power1.inOut', onUpdate: apply }, `<${P.drawFly * 0.4}`);
    if (opts.onFlip) t.call(opts.onFlip, undefined, `<${P.drawFly * 0.15}`);
  }
  // 落位（弹）：入扇形时一个小回弹
  t.fromTo(card.scale, { x: target.scale * 1.06, y: target.scale * 1.06, z: target.scale * 1.06 }, {
    x: target.scale,
    y: target.scale,
    z: target.scale,
    duration: P.drawSettle,
    ease: 'back.out(1.4)',
    immediateRender: false,
  });
  return t;
}

// 震屏（分镜 1.4）：相机位置叠加衰减噪声。幅度按画面高的百分比，换算成镜头到台面中心距离上的世界单位。
// S3 再带一下白闪（亮度加 15%，flash 秒）。
export const SHAKE = {
  S1: { amp: 0.003, time: 0.12 },
  S2: { amp: 0.008, time: 0.2 },
  S3: { amp: 0.015, time: 0.32 },
};

export function screenShake(stage: Stage, level: keyof typeof SHAKE, flash = 0.06): gsap.core.Timeline {
  const t = gsap.timeline();
  const { amp, time } = SHAKE[level];
  const dist = stage.camera.position.distanceTo(stage.cameraTarget);
  const height = 2 * dist * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2));
  const a = amp * height;
  const st = { k: 1 };
  const s = stage.cameraShake;
  t.to(st, {
    k: 0,
    duration: time,
    ease: 'none',
    onUpdate: () => {
      s.set((Math.random() * 2 - 1) * a * st.k, (Math.random() * 2 - 1) * a * st.k, (Math.random() * 2 - 1) * a * 0.5 * st.k);
    },
    onComplete: () => s.set(0, 0, 0),
  });
  if (level === 'S3' && flash > 0) {
    t.to(stage.look, { brightness: 0.15, duration: 0.01 }, 0);
    t.to(stage.look, { brightness: 0, duration: flash, ease: 'power1.in' }, 0.01);
  }
  return t;
}

// 大字（胜负）："胜利""失败""平局"。SDF 文字加背后一圈进泛光的光晕，正对镜头
export class BigWord {
  readonly group = new THREE.Group();
  readonly text: Text;
  readonly halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor(stage: Stage, layer: THREE.Object3D, center: Vec3, word: string, color: number, haloColor: number | null) {
    this.text = sdf(word, 1.9, color);
    this.text.letterSpacing = 0.25;
    this.text.outlineWidth = '4%';
    (this.text.material as THREE.Material).depthTest = false;
    this.text.renderOrder = 61;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.halo = new THREE.Mesh(
      planeGeo,
      new THREE.MeshBasicMaterial({ map: tex, color: haloColor ?? 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }),
    );
    this.halo.scale.set(8, 3, 1);
    this.halo.renderOrder = 60;
    this.halo.visible = haloColor !== null;
    this.group.add(this.halo, this.text);
    this.group.position.set(center.x, center.y, center.z);
    this.group.quaternion.copy(stage.camera.quaternion);
    this.group.visible = false;
    layer.add(this.group);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.text.dispose();
    this.halo.material.map?.dispose();
    this.halo.material.dispose();
  }
}

export { cameraUp };

// 爆牌的燃烧（E04）：卡牌从下往上溶解，烧到的边缘一道橙色亮线（进泛光）。用裁切平面实现：卡牌的材质先各复制一份
// （其中有多张牌共用的，不能直接改），装上一个跟着卡牌走的平面；SDF 文字用 troika 自己的 clipRect。
// 返回的时间线结束时卡牌已经整张烧没，调用方负责销毁。
export function burnAway(card: CardView, duration: number, onEdge?: (p: THREE.Vector3) => void): gsap.core.Timeline {
  const t = gsap.timeline();
  const H = 2.1;
  const local = new THREE.Plane(new THREE.Vector3(0, 1, 0), H / 2 + 0.05);
  const world = new THREE.Plane();
  const texts: Text[] = [];
  const edge = new THREE.Mesh(planeGeo, glowMaterial(0xff7a1a, 2.4));
  edge.scale.set(1.62, 0.07, 1);
  edge.position.z = 0.05;
  markBloom(edge);
  const st = { y: -H / 2 - 0.05 };
  const apply = () => {
    card.updateMatrixWorld(true);
    local.constant = -st.y;
    world.copy(local).applyMatrix4(card.body.matrixWorld);
    edge.position.y = st.y;
    for (const tx of texts) {
      const p = tx.worldToLocal(card.body.localToWorld(new THREE.Vector3(0, st.y, 0)));
      tx.clipRect = [-100, p.y, 100, 100];
    }
  };
  t.call(() => {
    card.body.traverse((o) => {
      if (o instanceof Text) {
        texts.push(o);
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const cloned = (m.material as THREE.Material).clone();
      cloned.clippingPlanes = [world];
      m.material = cloned;
    });
    card.body.add(edge);
    apply();
    onEdge?.(card.body.localToWorld(new THREE.Vector3(0, st.y, 0)));
  });
  t.to(st, { y: H / 2 + 0.05, duration, ease: 'none', onUpdate: apply });
  t.call(() => {
    edge.removeFromParent();
    (edge.material as THREE.Material).dispose();
  });
  return t;
}
