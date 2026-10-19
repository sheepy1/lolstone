// 随从的攻击、生命徽章（spec 5.4 v0.6.2）：嵌在底座内部左下（攻击）和右下（生命）的两个对称的凸起六边形金属徽章，
// 和手牌卡面上攻击左下、生命右下的位置一一对应。顶面刻着剑或血滴，数字是 SDF 文本：受伤红、增益绿。
// 圣盾时生命徽章外圈亮一圈白色护盾环。受伤、治疗、增益、减益的动画作用在徽章上（pop）。
import gsap from 'gsap';
import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { cardFontUrl } from '../assets/manifest';
import { glowMaterial, markBloom } from '../presentation/fx/materials';
import { shared } from './dispose';

export type BadgeKind = 'attack' | 'health';

const R = 0.24; // 徽章外接圆半径
const H = 0.09; // 凸起高度
const bodyGeo = shared(new THREE.CylinderGeometry(R, R + 0.02, H, 6));
const bezelGeo = shared(new THREE.CylinderGeometry(R + 0.045, R + 0.06, H * 0.55, 6));
const topGeo = shared(new THREE.CircleGeometry(R * 0.86, 6));
const ringGeo = shared(new THREE.TorusGeometry(R + 0.09, 0.028, 6, 6));

const bodyMats: Record<BadgeKind, THREE.MeshStandardMaterial> = {
  attack: shared(new THREE.MeshStandardMaterial({ color: 0xc9781f, metalness: 0.75, roughness: 0.32, flatShading: true })),
  health: shared(new THREE.MeshStandardMaterial({ color: 0xb4262c, metalness: 0.6, roughness: 0.35, flatShading: true })),
};
const bezelMat = shared(new THREE.MeshStandardMaterial({ color: 0xc8aa6e, metalness: 0.85, roughness: 0.28, flatShading: true }));
const ringMat = shared(glowMaterial(0xf2f6ff, 1.8));
const FROST = new THREE.Color(0xbfe8ff);

// 顶面的刻纹：攻击是剑，生命是血滴，颜色比徽章深一点
function decal(kind: BadgeKind): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = kind === 'attack' ? '#a35a12' : '#86161c';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = kind === 'attack' ? '#7d430c' : '#5e0f13';
  g.beginPath();
  if (kind === 'attack') {
    g.moveTo(64, 14);
    g.lineTo(74, 30);
    g.lineTo(72, 84);
    g.lineTo(92, 84);
    g.lineTo(92, 94);
    g.lineTo(70, 94);
    g.lineTo(70, 116);
    g.lineTo(58, 116);
    g.lineTo(58, 94);
    g.lineTo(36, 94);
    g.lineTo(36, 84);
    g.lineTo(56, 84);
    g.lineTo(54, 30);
  } else {
    g.moveTo(64, 14);
    g.bezierCurveTo(84, 44, 100, 64, 100, 82);
    g.bezierCurveTo(100, 104, 84, 116, 64, 116);
    g.bezierCurveTo(44, 116, 28, 104, 28, 82);
    g.bezierCurveTo(28, 64, 44, 44, 64, 14);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const decalMats: Record<BadgeKind, THREE.MeshStandardMaterial> = {
  attack: shared(new THREE.MeshStandardMaterial({ map: shared(decal('attack')), metalness: 0.5, roughness: 0.45 })),
  health: shared(new THREE.MeshStandardMaterial({ map: shared(decal('health')), metalness: 0.5, roughness: 0.45 })),
};

export class StatBadge extends THREE.Group {
  // 动画在 body 上做弹跳，外层位置固定在底座上
  readonly body = new THREE.Group();
  private readonly num = new Text();
  private readonly shieldRing: THREE.Mesh;
  private readonly bodyMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private value = NaN;
  private color = -1;

  constructor(readonly kind: BadgeKind) {
    super();
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.position.y = (H * 0.55) / 2;
    bezel.castShadow = true;
    // 每个徽章自己的一份材质：闪红、闪绿只改自己
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMats[kind].clone());
    this.bodyMesh.position.y = H / 2 + 0.02;
    this.bodyMesh.castShadow = true;
    const top = new THREE.Mesh(topGeo, decalMats[kind]);
    top.rotation.x = -Math.PI / 2;
    top.rotation.z = Math.PI / 6;
    top.position.y = H + 0.022;
    const n = this.num;
    n.font = cardFontUrl();
    n.fontSize = 0.31;
    n.anchorX = 'center';
    n.anchorY = 'middle';
    n.outlineWidth = '12%';
    n.outlineColor = 0x000000;
    n.rotation.x = -Math.PI / 2;
    n.position.y = H + 0.03;
    this.shieldRing = new THREE.Mesh(ringGeo, ringMat);
    this.shieldRing.rotation.x = -Math.PI / 2;
    this.shieldRing.rotation.z = Math.PI / 6;
    this.shieldRing.position.y = 0.04;
    this.shieldRing.visible = false;
    markBloom(this.shieldRing);
    this.body.add(bezel, this.bodyMesh, top, n, this.shieldRing);
    this.add(this.body);
  }

  set(value: number, color: number): void {
    if (value === this.value && color === this.color) return;
    this.value = value;
    this.color = color;
    this.num.text = String(Math.max(0, value));
    this.num.color = color;
    this.num.sync();
  }

  setShield(on: boolean): void {
    this.shieldRing.visible = on;
  }

  // 数值变化时弹一下（m4-storyboard E12：1 → 1.25 → 1，180ms 弹），tint 是闪的颜色（受伤红、治疗绿、增益金、减益紫），
  // flash 是闪色的时长。数字本身不插值，由调用方在同一帧跳到新值
  pop(tint: number, scale = 1.25, duration = 0.18, flash = 0.12): gsap.core.Timeline {
    const t = gsap.timeline();
    const mat = this.bodyMesh.material;
    gsap.killTweensOf(this.body.scale);
    t.call(() => mat.emissive.setHex(tint));
    t.fromTo(mat, { emissiveIntensity: 1.4 }, { emissiveIntensity: 0, duration: flash, ease: 'power1.in', immediateRender: false }, 0);
    const up = duration * 0.3;
    t.fromTo(this.body.scale, { x: 1, y: 1, z: 1 }, { x: scale, y: scale, z: scale, duration: up, ease: 'power2.out', immediateRender: false }, 0);
    t.to(this.body.scale, { x: 1, y: 1, z: 1, duration: duration - up, ease: 'back.out(1.4)' }, up);
    return t;
  }

  // 冻结时徽章蒙一层淡蓝（E17），解冻时去掉
  setFrost(on: boolean): void {
    const mat = this.bodyMesh.material;
    const base = bodyMats[this.kind].color;
    if (on) mat.color.copy(base).lerp(FROST, 0.55);
    else mat.color.copy(base);
  }

  // 获得圣盾：护盾环从大收到原位、亮起（E18，150ms）
  flashShield(duration = 0.15): gsap.core.Timeline {
    const t = gsap.timeline();
    const ring = this.shieldRing;
    ring.visible = true;
    t.fromTo(ring.scale, { x: 1.6, y: 1.6, z: 1.6 }, { x: 1, y: 1, z: 1, duration, ease: 'back.out(1.4)' });
    return t;
  }

  // 圣盾被打破：护盾环放大碎掉
  breakShield(): gsap.core.Timeline {
    const t = gsap.timeline();
    const ring = this.shieldRing;
    t.to(ring.scale, { x: 1.7, y: 1.7, z: 1.7, duration: 0.12, ease: 'power2.out' });
    t.call(() => {
      ring.visible = false;
      ring.scale.setScalar(1);
    });
    return t;
  }
}
