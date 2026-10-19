// 占位动画用的通用 3D 效果：飘字、扩散光圈、飞弹、横幅、粒子。每个函数返回一条 GSAP 时间线，
// 3D 对象在时间线播放时才创建（.call），播完自己移除并释放。M4 换成精细版本时签名不变。
import gsap from 'gsap';
import * as THREE from 'three';
import { FONT_CN, FONT_NUM } from '../../scene/theme';
import type { Vec3 } from '../layout';
import { hdr } from './materials';
import { shared } from '../../scene/dispose';

const MAX_PARTICLES = 2000; // spec 5.10
let liveParticles = 0;

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// 一行字的 sprite。height 是世界单位里的字高。
export function textSprite(str: string, color: number, height: number, font = FONT_NUM, band = false): THREE.Sprite {
  const px = 96;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = `900 ${px}px ${font}`;
  const w = Math.ceil(g.measureText(str).width + px * 0.6);
  const bandW = band ? Math.max(w + px * 2, px * 8) : w;
  c.width = bandW;
  c.height = Math.ceil(px * (band ? 1.9 : 1.4));
  if (band) {
    g.fillStyle = 'rgba(0,0,0,0.62)';
    g.fillRect(0, c.height * 0.08, c.width, c.height * 0.84);
    g.fillStyle = '#c8aa6e';
    g.fillRect(0, c.height * 0.08, c.width, 6);
    g.fillRect(0, c.height * 0.92 - 6, c.width, 6);
  }
  g.font = `900 ${px}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = px * 0.16;
  g.strokeStyle = '#000';
  g.strokeText(str, c.width / 2, c.height / 2);
  g.fillStyle = css(color);
  g.fillText(str, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  const h = height * (c.height / px);
  s.scale.set((h * c.width) / c.height, h, 1);
  s.renderOrder = 20;
  return s;
}

function disposeSprite(s: THREE.Sprite | null): void {
  if (!s) return;
  s.removeFromParent();
  s.material.map?.dispose();
  s.material.dispose();
}

// 伤害、治疗等飘字：弹出、上浮、淡出。size 沿用 2D 版的像素字号，换算成世界单位。
export function floatText(layer: THREE.Object3D, at: () => Vec3, str: string, color: number, size = 46): gsap.core.Timeline {
  const tl = gsap.timeline();
  let s: THREE.Sprite | null = null;
  const st = { k: 0.4, rise: 0, a: 1 };
  const base = { x: 0, y: 0, z: 0, sx: 1, sy: 1 };
  const apply = () => {
    if (!s) return;
    s.position.set(base.x, base.y + st.rise, base.z);
    s.scale.set(base.sx * st.k, base.sy * st.k, 1);
    s.material.opacity = st.a;
  };
  tl.call(() => {
    s = textSprite(str, color, (size / 46) * 0.62);
    const p = at();
    Object.assign(base, { x: p.x, y: p.y + 1.1, z: p.z, sx: s.scale.x, sy: s.scale.y });
    layer.add(s);
    apply();
  });
  tl.to(st, { k: 1.15, duration: 0.14, ease: 'back.out(3)', onUpdate: apply });
  tl.to(st, { rise: 0.9, a: 0, duration: 0.5, ease: 'power1.in', onUpdate: apply });
  tl.call(() => disposeSprite(s));
  return tl;
}

const ringGeo = shared(new THREE.RingGeometry(0.82, 1, 48));

// 贴着台面扩散的光圈。radius 沿用 2D 版的像素半径，换算成世界单位。
export function ring(layer: THREE.Object3D, at: () => Vec3, color: number, radius = 80, duration = 0.4): gsap.core.Timeline {
  const tl = gsap.timeline();
  let m: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  const st = { r: 0.15, a: 1 };
  const r1 = radius / 80;
  tl.call(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: hdr(color, 4),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    m = new THREE.Mesh(ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    layer.add(m);
  });
  tl.to(st, {
    r: r1,
    a: 0,
    duration,
    ease: 'power2.out',
    onUpdate: () => {
      if (!m) return;
      const p = at();
      m.position.set(p.x, Math.max(0.06, p.y + 0.06), p.z);
      m.scale.setScalar(st.r);
      m.material.opacity = st.a;
    },
  });
  tl.call(() => {
    m?.removeFromParent();
    m?.material.dispose();
  });
  return tl;
}

const ballGeo = shared(new THREE.SphereGeometry(0.16, 16, 12));

// 飞弹：一颗发光的球沿弧线从 from 飞到 to。
export function projectile(layer: THREE.Object3D, from: () => Vec3, to: () => Vec3, color: number, duration = 0.3): gsap.core.Timeline {
  const tl = gsap.timeline();
  let m: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  const st = { t: 0 };
  tl.call(() => {
    m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: hdr(color, 6), toneMapped: false }));
    const p = from();
    m.position.set(p.x, p.y + 0.6, p.z);
    layer.add(m);
  });
  tl.to(st, {
    t: 1,
    duration,
    ease: 'power1.in',
    onUpdate: () => {
      if (!m) return;
      const a = from();
      const b = to();
      const k = st.t;
      m.position.set(a.x + (b.x - a.x) * k, a.y + 0.6 + (b.y - a.y) * k + Math.sin(k * Math.PI) * 1.4, a.z + (b.z - a.z) * k);
    },
  });
  tl.call(() => {
    m?.removeFromParent();
    m?.material.dispose();
  });
  return tl;
}

// 横幅："你的回合"、"对方回合"、"胜利"。在镜头前滑入、停顿、淡出。
export function banner(layer: THREE.Object3D, center: { pos: Vec3 }, str: string, color: number, hold = 0.6, size = 84): gsap.core.Timeline {
  const tl = gsap.timeline();
  let s: THREE.Sprite | null = null;
  const st = { x: -3, a: 0 };
  const sync = () => {
    if (!s) return;
    s.position.set(center.pos.x + st.x, center.pos.y, center.pos.z);
    s.material.opacity = st.a;
  };
  tl.call(() => {
    s = textSprite(str, color, (size / 84) * 1.0, FONT_CN, true);
    layer.add(s);
    sync();
  });
  tl.to(st, { x: 0, a: 1, duration: 0.3, ease: 'power3.out', onUpdate: sync });
  tl.to(st, { duration: hold });
  tl.to(st, { x: 2.5, a: 0, duration: 0.3, ease: 'power2.in', onUpdate: sync });
  tl.call(() => disposeSprite(s));
  return tl;
}

// 粒子迸发：n 个光点从中心向四周飞散、受重力下落、淡出。总数超过上限时不再生成（spec 5.10）。
export function burst(layer: THREE.Object3D, at: () => Vec3, color: number, n = 14, duration = 0.5): gsap.core.Timeline {
  const tl = gsap.timeline();
  let points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  let vel: Float32Array | null = null;
  let origin: Vec3 = { x: 0, y: 0, z: 0 };
  let count = 0;
  const st = { t: 0 };
  tl.call(() => {
    origin = at();
    count = Math.max(0, Math.min(n, MAX_PARTICLES - liveParticles));
    liveParticles += count;
    const pos = new Float32Array(count * 3);
    vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.6;
      vel[i * 3] = Math.cos(a) * sp;
      vel[i * 3 + 1] = 1 + Math.random() * 2;
      vel[i * 3 + 2] = Math.sin(a) * sp;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: hdr(color, 3.5),
      size: 0.14,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    points = new THREE.Points(geo, mat);
    layer.add(points);
  });
  tl.to(st, {
    t: 1,
    duration,
    ease: 'power2.out',
    onUpdate: () => {
      if (!points || !vel) return;
      const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const t = st.t;
      for (let i = 0; i < count; i++) {
        attr.setXYZ(i, origin.x + vel[i * 3] * t, origin.y + 0.5 + vel[i * 3 + 1] * t - 2.2 * t * t, origin.z + vel[i * 3 + 2] * t);
      }
      attr.needsUpdate = true;
      points.material.opacity = 1 - t;
    },
  });
  tl.call(() => {
    liveParticles -= count;
    count = 0;
    if (points) {
      points.removeFromParent();
      points.geometry.dispose();
      points.material.dispose();
    }
  });
  return tl;
}

// 空白等待，占住时间线上的一段时长。
export function wait(seconds: number): gsap.core.Timeline {
  return gsap.timeline().to({}, { duration: seconds });
}
