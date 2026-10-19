// 英雄：水晶枢纽（spec 5.2、5.4 v0.6.7）。枢纽和英雄头像融为一体，小巧、不悬空、不挡视线：头像圆盘嵌在底座上，
// 生命值是底座右前角的一枚六边形生命徽章（和随从的生命徽章同一套造型，大一号）。用户定稿的是方案 b：
//   b 暗色金属六棱台，四周一圈半球形玻璃罩小灯（nexusLamps.ts），头像嵌在顶面。默认用它。
// 另外两个否掉的方案留着对比，用地址参数 ?nexus=a|c 切换（spec 5.4 写明不再回头）：
//   a 水晶台座：底座本身是半透明的发光水晶六棱台，上面一圈金属沿；
//   c 水晶环：薄的金属底座，头像外围一圈发光的水晶环。
// 生命低于 10 时，b 的小灯从后往前逐颗熄灭、剩下的不稳地闪；a、c 的水晶闪烁。输掉时发光部分碎掉。
import gsap from 'gsap';
import * as THREE from 'three';
import { getCard, getHeroClass, type HeroClass } from '../engine';
import { NEXUS } from '../presentation/layout';
import { EDGE_GLOW, flashMaterial, glowMaterial, markBloom } from '../presentation/fx/materials';
import { makeLabelCanvas, portraitTexture, strokeText, hexPath } from './canvasArt';
import { NexusLamps } from './nexusLamps';
import { StatBadge } from './statBadge';
import { COLORS, FONT_CN, FONT_NUM, REGION_COLORS } from './theme';
import { shared } from './dispose';

export type NexusStyle = 'a' | 'b' | 'c';

export function nexusStyle(): NexusStyle {
  const v = new URLSearchParams(globalThis.location?.search ?? '').get('nexus');
  return v === 'a' || v === 'c' ? v : 'b';
}

const discGeo = shared(new THREE.CircleGeometry(NEXUS.discRadius, 40));
const discRimGeo = shared(new THREE.TorusGeometry(NEXUS.discRadius + 0.02, 0.05, 8, 40));
const targetRingGeo = shared(new THREE.TorusGeometry(1.32, 0.07, 8, 48));

export class HeroView extends THREE.Group {
  readonly body = new THREE.Group();
  readonly flash: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  // 会发光、会闪烁、输掉时碎掉的水晶部分
  private readonly crystalMat: THREE.MeshStandardMaterial;
  private readonly crystals: THREE.Object3D[] = [];
  private readonly targetRing: THREE.Mesh;
  private readonly hp = new StatBadge('health');
  private low: gsap.core.Tween | null = null;
  private dimmed = false;
  private readonly glow: number;
  // 方案 b 的一圈小灯（其他方案为 null）
  readonly lamps: NexusLamps | null = null;

  constructor(cls: HeroClass, enemy: boolean, side: 0 | 1, style: NexusStyle = nexusStyle()) {
    super();
    const col = REGION_COLORS[cls];
    const teamColor = enemy ? 0xff3030 : 0x3a8cff;
    this.glow = style === 'a' ? 0.9 : 1.1;
    this.crystalMat = new THREE.MeshStandardMaterial({
      color: enemy ? 0x9a2020 : 0x1f5fd0,
      emissive: teamColor,
      emissiveIntensity: this.glow,
      roughness: 0.2,
      metalness: 0.3,
      flatShading: true,
      transparent: style === 'a',
      opacity: style === 'a' ? 0.85 : 1,
    });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.45, metalness: 0.75, flatShading: true });
    const trim = new THREE.MeshStandardMaterial({ color: col.accent, roughness: 0.3, metalness: 0.85, flatShading: true });
    const add = (m: THREE.Mesh, crystal = false) => {
      m.castShadow = true;
      m.receiveShadow = true;
      this.body.add(m);
      if (crystal) {
        this.crystals.push(m);
        markBloom(m);
      }
      return m;
    };
    if (style === 'a') {
      // 水晶六棱台，上面一圈金属沿
      const c = add(new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.12, 0.34, 6), this.crystalMat), true);
      c.position.y = 0.17;
      const lip = add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.07, 6), trim));
      lip.position.y = 0.37;
    } else if (style === 'b') {
      // 深色金属六棱台，四周一圈半球形小灯；灯座和台座的金属沿同一种材质
      const base = add(new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.1, 0.34, 6), metal));
      base.position.y = 0.17;
      const lip = add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.05, 6), trim));
      lip.position.y = 0.36;
      // 双方的呼吸错开半拍，不同步起伏
      this.lamps = new NexusLamps(teamColor, trim, side * 1.3);
      this.body.add(this.lamps);
      this.crystals.push(...this.lamps.roots);
    } else {
      // 薄金属底座，头像外围一圈发光水晶环
      const base = add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.22, 6), metal));
      base.position.y = 0.11;
    }
    // 头像圆盘嵌在底座上，朝镜头倾斜
    const disc = new THREE.Group();
    disc.position.set(NEXUS.discPos.x, NEXUS.discPos.y, NEXUS.discPos.z);
    disc.rotation.x = NEXUS.discTilt;
    const portrait = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({ map: portraitTexture(`hero:${cls}`, getHeroClass(cls).champion), roughness: 0.55 }));
    const rim = new THREE.Mesh(discRimGeo, style === 'c' ? this.crystalMat : trim);
    if (style === 'c') {
      rim.scale.set(1.12, 1.12, 2.4);
      this.crystals.push(rim);
      markBloom(rim);
    }
    rim.castShadow = true;
    const backing = new THREE.Mesh(new THREE.CylinderGeometry(NEXUS.discRadius + 0.06, NEXUS.discRadius + 0.1, 0.12, 24), metal);
    backing.rotation.x = Math.PI / 2;
    backing.position.z = -0.065;
    backing.castShadow = true;
    this.flash = new THREE.Mesh(discGeo, flashMaterial());
    this.flash.position.z = 0.01;
    disc.add(backing, portrait, rim, this.flash);
    this.body.add(disc);
    // 生命徽章嵌在底座右前角
    this.hp.position.set(NEXUS.hpPos.x, NEXUS.hpPos.y - 0.05, NEXUS.hpPos.z);
    this.hp.scale.setScalar(NEXUS.hpScale);
    this.body.add(this.hp);
    this.targetRing = new THREE.Mesh(targetRingGeo, glowMaterial(COLORS.target, 2.0));
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.position.y = 0.05;
    this.targetRing.visible = false;
    markBloom(this.targetRing);
    this.body.add(this.targetRing);
    this.add(this.body);
    this.userData.pick = { kind: 'hero', side };
  }

  // 每帧调：水晶的光缓慢呼吸
  tick(t: number): void {
    if (this.lamps) return this.lamps.tick(t);
    if (this.low) return;
    this.crystalMat.emissiveIntensity = this.glow * (0.85 + 0.15 * Math.sin(t * 1.6));
  }

  setHealth(health: number, max: number): void {
    this.hp.set(health, health < max ? COLORS.debuffed : 0xffffff);
    if (this.lamps) return this.lamps.setHealth(health);
    const lowNow = health < 10;
    if (lowNow && !this.low) {
      this.low = gsap.to(this.crystalMat, { emissiveIntensity: 0.15, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    } else if (!lowNow && this.low) {
      this.low.kill();
      this.low = null;
      this.crystalMat.emissiveIntensity = this.glow;
    }
  }

  // 是不是这一方的回合：方案 b 的小灯自己回合亮一些
  setActive(on: boolean): void {
    this.lamps?.setActive(on);
  }

  // 受伤、治疗时生命徽章弹一下
  popHealth(tint: number): void {
    this.hp.pop(tint);
  }

  setTargetable(mode: 'none' | 'target' | 'dim'): void {
    this.targetRing.visible = mode === 'target';
    const dim = mode === 'dim';
    if (dim !== this.dimmed) {
      this.dimmed = dim;
      this.crystalMat.color.multiplyScalar(dim ? 0.45 : 1 / 0.45);
      this.lamps?.setDim(dim);
    }
  }

  // 输掉时水晶闪亮后碎掉（胜负动画用）
  shatter(): gsap.core.Timeline {
    const t = gsap.timeline();
    this.low?.kill();
    this.low = null;
    t.to(this.crystalMat, { emissiveIntensity: 3, duration: 0.25 });
    t.call(() => this.lamps?.flare(), undefined, 0);
    for (const c of this.crystals) t.to(c.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.35, ease: 'power3.in' }, 0.25);
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
    // 名字长的（诺克萨斯断头台）缩小字号，放得进六边形
    strokeText(g, def.name, 128, 140, def.name.length > 3 ? Math.floor(190 / def.name.length) : 64, '#ffffff', FONT_CN, 0.12);
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
    top.position.y = 0.245;
    this.ring = new THREE.Mesh(powerRingGeo, glowMaterial(COLORS.playable, EDGE_GLOW));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.visible = false;
    markBloom(this.ring);
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
