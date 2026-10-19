// 枢纽台座上的裂纹（m4-storyboard E24、spec 5.2"受重伤时台座出现裂痕"）。
// 生命降到上限的 75% / 50% / 25% 以下时分别出现第一、二、三级裂纹并常驻；生命回升到阈值以上时那一级退掉，所以治疗后
// 裂纹不会继续加深。受伤的命中帧裂纹里的红光闪一下（150ms）。
// 做法：三层贴着台座侧面的六棱台薄壳（不封顶），每层一张 canvas 画的裂纹：深色裂缝（漫反射贴图带透明）加缝里的红光
// （自发光贴图）。壳挂在枢纽的 body 上，跟着枢纽抖动；按枢纽懒创建，不改 HeroView。
import gsap from 'gsap';
import * as THREE from 'three';
import type { HeroView } from '../../scene/heroView';

export const CRACKS = {
  thresholds: [0.75, 0.5, 0.25], // 生命比例低于这些值时出现第 1、2、3 级
  glow: 0.5, // 平时缝里红光的强度
  flash: 3.2, // 受伤时闪到
  flashTime: 0.15,
};

// 台座：CylinderGeometry(0.98, 1.1, 0.34, 6)，中心 y = 0.17（heroView.ts 方案 b、a）
const TOP_R = 0.98;
const BOTTOM_R = 1.1;
const H = 0.34;
const W = 1024;
const HH = 128;

// 简单的可复现随机数
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 一条从 (x, y) 出发、带分叉的折线裂缝
function crack(r: () => number, x: number, y: number, dir: number, len: number, out: [number, number][][], depth = 0): void {
  const pts: [number, number][] = [[x, y]];
  let a = dir;
  let cx = x;
  let cy = y;
  const steps = 5 + Math.floor(r() * 4);
  for (let i = 0; i < steps; i++) {
    a += (r() - 0.5) * 1.1;
    const seg = (len / steps) * (0.6 + r() * 0.8);
    cx += Math.cos(a) * seg;
    cy += Math.sin(a) * seg;
    pts.push([cx, cy]);
    if (depth < 2 && r() < 0.28) crack(r, cx, cy, a + (r() < 0.5 ? 0.9 : -0.9), len * 0.45, out, depth + 1);
  }
  out.push(pts);
}

// 第 level 级的裂纹贴图：[漫反射（深色缝、其余透明）, 自发光（缝里的红）]
function crackTextures(level: number, seed: number): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const r = rng(seed * 7919 + level * 104729);
  const lines: [number, number][][] = [];
  // u 方向绕台座一周，六个侧面各占 1/6；正对镜头的是第 0 面和第 5 面（+z 两侧），裂纹集中在那里
  const faces = level === 0 ? [0, 5] : level === 1 ? [0, 5, 1, 4] : [0, 5, 1, 4, 0, 5, 2, 3];
  const per = level === 0 ? 1 : level === 1 ? 1 : 1;
  for (const f of faces) {
    for (let i = 0; i < per; i++) {
      // 从顶边或底边、或者小灯的灯座边上裂开
      const cx = ((f + 0.15 + r() * 0.7) / 6) * W;
      const fromTop = r() < 0.5;
      const y = fromTop ? 2 : HH - 2;
      crack(r, cx, y, (fromTop ? Math.PI / 2 : -Math.PI / 2) + (r() - 0.5) * 0.9, HH * (0.7 + level * 0.25), lines);
    }
  }
  const draw = (stroke: string, width: number, blur: number) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = HH;
    const g = c.getContext('2d')!;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = stroke;
    g.shadowColor = stroke;
    g.shadowBlur = blur;
    for (const pts of lines) {
      g.lineWidth = width;
      g.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return [draw('rgba(8,6,6,0.95)', 5, 0), draw('rgb(255,40,20)', 2.2, 6)];
}

// 台座顶面（金属沿到头像圆盘之间那一圈）的裂纹：从圆盘边沿往外裂，靠镜头的一侧（画面下方）先裂
const TOP = 512;
function topTextures(level: number, seed: number): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const r = rng(seed * 31337 + level * 7907);
  const lines: [number, number][][] = [];
  const n = [3, 4, 5][level];
  for (let i = 0; i < n; i++) {
    // 角度：0 是画面下方（靠镜头），第一级集中在下半圈，往后的级别往两侧和后方扩
    const spread = [1.1, 1.9, 3.0][level];
    const a = Math.PI / 2 + (r() - 0.5) * 2 * spread;
    const r0 = TOP * 0.36;
    crack(r, TOP / 2 + Math.cos(a) * r0, TOP / 2 + Math.sin(a) * r0, a + (r() - 0.5) * 0.5, TOP * 0.2, lines);
  }
  const draw = (stroke: string, width: number, blur: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = TOP;
    const g = c.getContext('2d')!;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = stroke;
    g.shadowColor = stroke;
    g.shadowBlur = blur;
    g.lineWidth = width;
    for (const pts of lines) {
      g.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return [draw('rgba(6,4,4,0.95)', 5, 0), draw('rgb(255,40,20)', 2.4, 7)];
}

const LIP_TOP = 0.386; // 金属沿的顶面（heroView.ts：沿的中心 0.36，厚 0.05）

export class NexusCracks extends THREE.Group {
  private readonly shells: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = []; // 每级两层：侧面、顶面
  private level = 0;

  constructor(seed: number) {
    super();
    for (let i = 0; i < 3; i++) {
      const grow = 0.004 + i * 0.002; // 一层比一层略大，不打架
      const geo = new THREE.CylinderGeometry(TOP_R + grow, BOTTOM_R + grow, H, 6, 1, true);
      const [map, glow] = crackTextures(i, seed);
      const mat = new THREE.MeshStandardMaterial({
        map,
        emissiveMap: glow,
        emissive: 0xffffff,
        emissiveIntensity: CRACKS.glow,
        transparent: true,
        depthWrite: false,
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = H / 2;
      m.visible = false;
      m.renderOrder = 2;
      this.shells.push(m);
      this.add(m);
      // 顶面的一层：六边形，顶点和台座对齐（台座的顶点在 +z 方向）
      const [tmap, tglow] = topTextures(i, seed);
      const top = new THREE.Mesh(
        new THREE.CircleGeometry(1.0, 6, Math.PI / 2),
        new THREE.MeshStandardMaterial({ map: tmap, emissiveMap: tglow, emissive: 0xffffff, emissiveIntensity: CRACKS.glow, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      top.rotation.x = -Math.PI / 2;
      top.position.y = LIP_TOP + 0.002 + i * 0.001;
      top.visible = false;
      top.renderOrder = 2;
      this.shells.push(top as unknown as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>);
      this.add(top);
    }
  }

  // 按生命比例显示几级裂纹。返回级数
  setHealth(health: number, max: number): number {
    const ratio = max > 0 ? health / max : 1;
    this.level = CRACKS.thresholds.filter((t) => ratio < t).length;
    this.shells.forEach((s, i) => (s.visible = Math.floor(i / 2) < this.level));
    return this.level;
  }

  // 预先编译裂纹的着色器（带透明的贴图材质，第一次英雄受伤时现编译会卡一帧）：临时显示、后台编译、再藏起来
  warm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): void {
    // 编译期间可能画出几帧：透明度和自发光先压到 0，看不见
    for (const s of this.shells) Object.assign(s, { visible: true }) && Object.assign(s.material, { opacity: 0, emissiveIntensity: 0 });
    const done = () =>
      this.shells.forEach((s, i) => {
        s.visible = Math.floor(i / 2) < this.level;
        Object.assign(s.material, { opacity: 1, emissiveIntensity: CRACKS.glow });
      });
    renderer.compileAsync(this, camera, scene).then(done, done);
  }

  // 命中帧：缝里的红光闪一下
  flash(): void {
    for (const s of this.shells) {
      if (!s.visible) continue;
      gsap.killTweensOf(s.material, 'emissiveIntensity');
      gsap.fromTo(s.material, { emissiveIntensity: CRACKS.flash }, { emissiveIntensity: CRACKS.glow, duration: CRACKS.flashTime, ease: 'power2.out' });
    }
  }
}

const cracks = new WeakMap<HeroView, NexusCracks>();

export function cracksOf(hero: HeroView): NexusCracks {
  let c = cracks.get(hero);
  if (!c) {
    c = new NexusCracks(hero.id);
    hero.body.add(c);
    cracks.set(hero, c);
  }
  return c;
}
