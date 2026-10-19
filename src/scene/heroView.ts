// 英雄：水晶枢纽（spec 5.2）。六棱台座上悬着一块缓慢旋转的自发光多面体晶体，台座正面嵌着朝向镜头的
// 英雄头像圆盘，旁边是生命数字。生命低于 10 时晶体闪烁。英雄技能是台面上的六棱柱，顶面是技能名，
// 用过之后变灰。都是占位几何体，M4 换材质和贴图。
import gsap from 'gsap';
import * as THREE from 'three';
import { getCard, getHeroClass, type HeroClass } from '../engine';
import { NEXUS } from '../presentation/layout';
import { EDGE_GLOW, flashMaterial, glowMaterial } from '../presentation/fx/materials';
import { makeLabelCanvas, portraitTexture, strokeText, hexPath } from './canvasArt';
import { COLORS, FONT_CN, FONT_NUM, REGION_COLORS } from './theme';
import { shared } from './dispose';

const pedestalGeo = shared(new THREE.CylinderGeometry(1.15, 1.3, 0.38, 6));
const crystalGeo = shared(new THREE.OctahedronGeometry(0.62, 0));
const discGeo = shared(new THREE.CircleGeometry(NEXUS.discRadius, 40));
const discRimGeo = shared(new THREE.TorusGeometry(0.64, 0.06, 8, 40));
const targetRingGeo = shared(new THREE.TorusGeometry(1.45, 0.07, 8, 48));

export class HeroView extends THREE.Group {
  readonly body = new THREE.Group();
  readonly flash: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  readonly crystal: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
  private readonly targetRing: THREE.Mesh;
  private readonly hp = makeLabelCanvas(160, 160);
  private low: gsap.core.Tween | null = null;
  private lastHp = '';
  private dimmed = false;

  constructor(cls: HeroClass, enemy: boolean, side: 0 | 1) {
    super();
    const col = REGION_COLORS[cls];
    const pedestal = new THREE.Mesh(pedestalGeo, new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.55, metalness: 0.5 }));
    pedestal.position.y = 0.19;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.crystal = new THREE.Mesh(
      crystalGeo,
      new THREE.MeshStandardMaterial({
        color: enemy ? 0xff6a6a : 0x6ab8ff,
        emissive: col.frame,
        emissiveIntensity: 2.4,
        roughness: 0.15,
        metalness: 0.2,
        flatShading: true,
      }),
    );
    this.crystal.scale.set(1, 1.6, 1);
    this.crystal.position.y = 1.65;
    this.crystal.castShadow = true;
    // 头像圆盘：嵌在台座正面，朝向镜头
    const disc = new THREE.Group();
    disc.position.set(NEXUS.discPos.x, NEXUS.discPos.y, NEXUS.discPos.z);
    disc.rotation.x = NEXUS.discTilt;
    const portrait = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({ map: portraitTexture(`hero:${cls}`, getHeroClass(cls).champion), roughness: 0.6 }));
    const rim = new THREE.Mesh(discRimGeo, new THREE.MeshStandardMaterial({ color: col.accent, roughness: 0.3, metalness: 0.8 }));
    this.flash = new THREE.Mesh(discGeo, flashMaterial());
    this.flash.position.z = 0.01;
    // 生命数字
    const hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hp.texture, transparent: true, toneMapped: false }));
    hpSprite.scale.set(NEXUS.hpSize, NEXUS.hpSize, 1);
    hpSprite.position.set(NEXUS.hpOffset.x, NEXUS.hpOffset.y, NEXUS.hpOffset.z);
    hpSprite.renderOrder = 4;
    disc.add(portrait, rim, this.flash, hpSprite);
    this.targetRing = new THREE.Mesh(targetRingGeo, glowMaterial(COLORS.target, 4.4));
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.position.y = 0.05;
    this.targetRing.visible = false;
    this.body.add(pedestal, this.crystal, disc, this.targetRing);
    this.add(this.body);
    this.userData.pick = { kind: 'hero', side };
  }

  // 每帧调：晶体缓慢旋转、上下浮动
  tick(t: number): void {
    this.crystal.rotation.y = t * 0.5;
    this.crystal.position.y = 1.65 + Math.sin(t * 1.3) * 0.08;
  }

  setHealth(health: number, max: number): void {
    const key = `${health}/${max}`;
    if (key !== this.lastHp) {
      this.lastHp = key;
      const g = this.hp.g;
      g.clearRect(0, 0, 160, 160);
      g.beginPath();
      g.arc(80, 80, 66, 0, Math.PI * 2);
      g.fillStyle = '#b02020';
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = '#2a0606';
      g.stroke();
      // 生命数字最低显示 0（引擎里的值可以是负的）
      const shown = Math.max(0, health);
      strokeText(g, String(shown), 80, 84, shown >= 10 ? 64 : 76, health < max ? '#ffd0d0' : '#ffffff', FONT_NUM, 0.14);
      this.hp.texture.needsUpdate = true;
    }
    const lowNow = health < 10;
    if (lowNow && !this.low) {
      this.low = gsap.to(this.crystal.material, { emissiveIntensity: 0.3, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    } else if (!lowNow && this.low) {
      this.low.kill();
      this.low = null;
      this.crystal.material.emissiveIntensity = 2.4;
    }
  }

  setTargetable(mode: 'none' | 'target' | 'dim'): void {
    this.targetRing.visible = mode === 'target';
    const dim = mode === 'dim';
    if (dim !== this.dimmed) {
      this.dimmed = dim;
      this.crystal.material.color.multiplyScalar(dim ? 0.45 : 1 / 0.45);
    }
  }

  // 输掉时晶体熄灭碎裂（胜负动画用）
  shatter(): gsap.core.Timeline {
    const t = gsap.timeline();
    t.to(this.crystal.material, { emissiveIntensity: 4, duration: 0.25 });
    t.to(this.crystal.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.35, ease: 'power3.in' });
    return t;
  }
}

const powerGeo = shared(new THREE.CylinderGeometry(0.62, 0.66, 0.24, 6));
const powerTopGeo = shared(new THREE.CircleGeometry(0.6, 6));
const powerRingGeo = shared(new THREE.TorusGeometry(0.78, 0.05, 8, 6));

// 英雄技能：台面上的六棱柱，顶面画技能名和费用；用过盖灰，能用时一圈绿色发光边。
export class HeroPowerView extends THREE.Group {
  readonly body = new THREE.Group();
  private readonly topMat: THREE.MeshStandardMaterial;
  private readonly ring: THREE.Mesh;
  private used = false;

  constructor(cls: HeroClass, side: 0 | 1) {
    super();
    const def = getCard(getHeroClass(cls).heroPower);
    const col = REGION_COLORS[cls];
    const label = makeLabelCanvas(256, 256);
    const g = label.g;
    hexPath(g, 128, 128, 124);
    g.fillStyle = `#${col.inner.toString(16).padStart(6, '0')}`;
    g.fill();
    hexPath(g, 128, 128, 100);
    g.lineWidth = 8;
    g.strokeStyle = `#${col.accent.toString(16).padStart(6, '0')}`;
    g.stroke();
    strokeText(g, def.name, 128, 140, 64, '#ffffff', FONT_CN, 0.12);
    g.beginPath();
    g.arc(128, 48, 30, 0, Math.PI * 2);
    g.fillStyle = '#2f8cff';
    g.fill();
    strokeText(g, String(def.cost), 128, 50, 40, '#fff', FONT_NUM);
    label.texture.needsUpdate = true;
    const prism = new THREE.Mesh(powerGeo, new THREE.MeshStandardMaterial({ color: col.frame, roughness: 0.4, metalness: 0.6 }));
    prism.position.y = 0.12;
    prism.castShadow = true;
    this.topMat = new THREE.MeshStandardMaterial({ map: label.texture, roughness: 0.5 });
    const top = new THREE.Mesh(powerTopGeo, this.topMat);
    top.rotation.x = -Math.PI / 2;
    top.rotation.z = Math.PI / 2;
    top.position.y = 0.245;
    this.ring = new THREE.Mesh(powerRingGeo, glowMaterial(COLORS.playable, EDGE_GLOW));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.visible = false;
    this.body.add(prism, top, this.ring);
    this.add(this.body);
    this.userData.pick = { kind: 'hero_power', side };
  }

  setUsed(used: boolean): void {
    if (used === this.used) return;
    this.used = used;
    this.topMat.color.setScalar(used ? 0.3 : 1);
  }

  setUsable(on: boolean): void {
    this.ring.visible = on;
  }
}
