// 英雄技能演出的画面部分（m4-storyboard E23）。时间表在 spellPlan.ts 的 HERO_POWER。
//
// - 按下（200ms）：图标缩到 0.92 再弹回 1，顶面按职业色亮一下；
// - 出手（300ms），四个职业一眼区分，靠颜色和粒子种类：
//   德玛西亚召集：光柱（holy_pillar）落在我方最右的空槽位，士兵从光中成形由 minion_summoned 接；
//   诺克萨斯断头台：一把旋转的斧刃从我方枢纽飞向敌方枢纽（线），身后跟挥砍残影（slash_trail），命中 spark_heavy、S1；
//   艾欧尼亚灵魄：粉色灵魄飞弹（fire_bolt color #ff7ad9）带两颗绕着转的小光球，命中 spark_light；
//   弗雷尔卓德寒冰箭：一支冰晶箭（fire_bolt color 冰）飞向目标，命中冰霜扩散，接 E17 覆冰；
// - 冷却（100ms）：灰色遮罩从下往上盖住图标，遮罩前沿有一道亮线。
//
// 冷却遮罩的做法：按下时就把技能设成"已用过"（顶面压暗），同时在顶面上盖一层和原来一样亮的图标；冷却时这层从下往上
// 裁掉，露出下面压暗的顶面。这样不管后面哪一组先同步局面（召唤、伤害都会同步），压暗都不会提前露出来。
import gsap from 'gsap';
import * as THREE from 'three';
import type { HeroClass, Side, TargetRef } from '../../engine';
import { heroPowerTexture } from '../../scene/canvasArt';
import type { HeroPowerView } from '../../scene/heroView';
import type { TableScene } from '../../scene/table';
import type { Vec3 } from '../layout';
import { markBloom } from './materials';
import { FX_PALETTE } from './particles';
import { screenShake } from './screen';
import { HERO_POWER } from './spellPlan';
import { frost_hit } from './spellPresets';

export const HERO_POWER_COLORS: Record<HeroClass, number> = {
  demacia: FX_PALETTE.light,
  noxus: 0xd23b3b,
  ionia: 0xff7ad9,
  freljord: FX_PALETTE.ice,
};

// ---------- 顶面的两层覆盖：亮图标（冷却时被裁掉）和职业色发光 ----------

// fire_bolt 预设的弧线抬高（particles/presets.ts），跟着飞的物件走同一条弧线
const BOLT_ARC = 0.9;
const TOP_R = 0.6; // 和 heroView 的顶面六边形同样大
const TOP_Y = 0.245;
const hexGeo = new THREE.CircleGeometry(TOP_R, 6);

type Cover = { lit: THREE.Mesh; litMat: THREE.MeshStandardMaterial; glow: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>; cut: { value: number } };
const covers = new WeakMap<HeroPowerView, Cover>();

// 裁切线 cut 是顶面局部 y（-R 到 R）：y < cut 的部分不画。顶面绕 x 转了 -90°，局部 -y 朝镜头，也就是画面的下方
function coverOf(view: HeroPowerView, cls: HeroClass): Cover {
  let c = covers.get(view);
  if (c) return c;
  const cut = { value: -TOP_R - 0.01 };
  const litMat = new THREE.MeshStandardMaterial({ map: heroPowerTexture(cls), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  litMat.onBeforeCompile = (sh) => {
    sh.uniforms.uCut = cut;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLocalY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLocalY;\nuniform float uCut;')
      .replace('void main() {', 'void main() {\n  if (vLocalY < uCut) discard;');
  };
  const lit = new THREE.Mesh(hexGeo, litMat);
  lit.rotation.x = -Math.PI / 2;
  lit.position.y = TOP_Y + 0.002;
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(HERO_POWER_COLORS[cls]) }, face: { value: 0 }, cut, band: { value: 0 } },
    vertexShader: `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float face;
      uniform float cut;
      uniform float band;
      varying vec2 vP;
      void main() {
        float r = length(vP) / ${TOP_R.toFixed(2)};
        float f = face * (0.35 + 0.65 * r * r);
        float b = band * exp(-abs(vP.y - cut) * 40.0);
        gl_FragColor = vec4(mix(color, vec3(1.0), 0.45) * f * 1.5 + vec3(1.0, 0.95, 0.85) * b, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // 亮图标那层用了深度偏移，这层要偏得更多才不被它挡住
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const glow = new THREE.Mesh(hexGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = TOP_Y + 0.006;
  lit.visible = glow.visible = false;
  view.body.add(lit, glow);
  c = { lit, litMat, glow, cut };
  covers.set(view, c);
  return c;
}

// 按下：缩到 0.92（起 80ms）再弹回（弹 120ms），顶面亮一下；同时盖上亮图标、把技能设成已用过
export function pressHeroPower(scene: TableScene, view: HeroPowerView, cls: HeroClass): gsap.core.Timeline {
  const H = HERO_POWER;
  const c = coverOf(view, cls);
  const t = gsap.timeline();
  const u = c.glow.material.uniforms;
  t.call(() => {
    c.cut.value = -TOP_R - 0.01;
    c.lit.visible = c.glow.visible = true;
    u.band.value = 0;
    view.setUsed(true);
    view.setUsable(false);
  });
  t.to(view.body.scale, { x: H.pressScale, y: H.pressScale, z: H.pressScale, duration: H.pressDown, ease: 'power3.in' }, 0);
  // 按到底的一帧，按钮脚下冒一圈职业色的光
  t.call(() => scene.particles.emit('buff_ring', { at: { x: view.position.x, y: 0, z: view.position.z }, color: HERO_POWER_COLORS[cls], scale: 0.7 }), undefined, H.pressDown);
  t.to(u.face, { value: H.glow, duration: H.pressDown, ease: 'power3.in' }, 0);
  t.to(view.body.scale, { x: 1, y: 1, z: 1, duration: H.pressUp, ease: 'back.out(1.4)' }, H.pressDown);
  t.to(u.face, { value: 0, duration: H.pressUp + H.cast * 0.5, ease: 'power2.out' }, H.pressDown);
  return t;
}

// 冷却：亮图标从下往上被裁掉（落），前沿一道亮线
export function cooldownWipe(view: HeroPowerView, cls: HeroClass): gsap.core.Timeline {
  const c = coverOf(view, cls);
  const u = c.glow.material.uniforms;
  const t = gsap.timeline();
  t.set(u.band, { value: 1.4 });
  t.fromTo(c.cut, { value: -TOP_R - 0.01 }, { value: TOP_R + 0.01, duration: HERO_POWER.cooldown, ease: 'power2.out', immediateRender: false });
  t.to(u.band, { value: 0, duration: 0.06 });
  t.call(() => {
    c.lit.visible = c.glow.visible = false;
  });
  return t;
}

// ---------- 出手 ----------

// 斧刃：一片月牙形的暗红金属刃加一截柄，平躺着旋转飞行
const axeGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, -0.42);
  s.quadraticCurveTo(0.62, -0.3, 0.6, 0.38);
  s.quadraticCurveTo(0.3, 0.1, 0.05, 0.12);
  s.lineTo(0, -0.42);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1 });
  g.translate(-0.05, 0, -0.02);
  return g;
})();
const haftGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6);

function makeAxe(): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(axeGeo, new THREE.MeshStandardMaterial({ color: 0x9a2a2a, metalness: 0.85, roughness: 0.3, emissive: 0x5a0a0a, emissiveIntensity: 0.6 }));
  const edge = new THREE.Mesh(axeGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a50).multiplyScalar(1.6), toneMapped: false }));
  edge.scale.set(0.6, 0.6, 1.3);
  edge.position.set(0.24, 0.06, 0);
  markBloom(edge);
  const haft = new THREE.Mesh(haftGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a20, metalness: 0.3, roughness: 0.7 }));
  haft.position.y = -0.05;
  const spin = new THREE.Group();
  spin.add(blade, edge, haft);
  spin.rotation.x = -Math.PI / 2; // 平躺，绕竖直轴转
  g.add(spin);
  return g;
}

// 冰晶箭：拉长的八面体，箭身朝飞行方向
function makeIceArrow(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(0.16, 0);
  geo.scale(1, 1, 4.2);
  const body = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(FX_PALETTE.ice).multiplyScalar(1.8), toneMapped: false }));
  markBloom(body);
  g.add(body);
  return g;
}

function disposeGroup(g: THREE.Object3D): void {
  g.removeFromParent();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.geometry !== axeGeo && m.geometry !== haftGeo) m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  });
}

// 沿一条抬高的弧线从 a 飞到 b（线），progress 0 到 1
function arcPoint(a: Vec3, b: Vec3, k: number, lift: number): THREE.Vector3 {
  return new THREE.Vector3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * lift, a.z + (b.z - a.z) * k);
}

// 一个物件沿弧线飞向目标，起点终点在播放时才取
function flyMesh(scene: TableScene, make: () => THREE.Group, from: () => Vec3, to: () => Vec3, duration: number, lift: number, each: (g: THREE.Group, k: number, dir: THREE.Vector3) => void): gsap.core.Timeline {
  const t = gsap.timeline();
  let g: THREE.Group | null = null;
  let a: Vec3 = { x: 0, y: 0, z: 0 };
  let b: Vec3 = a;
  const st = { k: 0 };
  t.call(() => {
    a = from();
    b = to();
    g = make();
    g.position.copy(arcPoint(a, b, 0, lift));
    scene.layers.fx.add(g);
  });
  t.to(st, {
    k: 1,
    duration,
    ease: 'none',
    onUpdate: () => {
      if (!g) return;
      const p = arcPoint(a, b, st.k, lift);
      const next = arcPoint(a, b, Math.min(1, st.k + 0.02), lift);
      const dir = next.sub(p).normalize();
      g.position.copy(p);
      each(g, st.k, dir);
    },
  });
  t.call(() => {
    if (g) disposeGroup(g);
    g = null;
  });
  t.eventCallback('onInterrupt', () => {
    if (g) disposeGroup(g);
  });
  return t;
}

export type HeroPowerCastOptions = {
  scene: TableScene;
  cls: HeroClass;
  side: Side;
  target: TargetRef | null;
  from: () => Vec3; // 技能按钮
  summonAt: () => Vec3; // 德玛西亚：最右槽位
};

// 出手段，从时间线 0 开始，命中帧在 travel（或光柱落地）处
export function heroPowerCast(o: HeroPowerCastOptions): gsap.core.Timeline {
  const { scene, cls } = o;
  const t = gsap.timeline();
  const color = HERO_POWER_COLORS[cls];
  const to = () => (o.target ? scene.pointOf(o.target) : scene.pointOf({ side: o.side === 0 ? 1 : 0, kind: 'hero' }));
  const ground = (p: Vec3): Vec3 => ({ x: p.x, y: 0, z: p.z });
  switch (cls) {
    case 'demacia': {
      // 按钮上冒一圈光，光柱落在最右槽位
      t.call(() => scene.particles.emit('holy_pillar', { at: ground(o.summonAt()), scale: 1.25, count: 32 }), undefined, 0);
      t.call(() => scene.particles.emit('dust_land', { at: ground(o.summonAt()), count: 8, color: 0xf3e2b0 }), undefined, HERO_POWER.demacia.land);
      return t;
    }
    case 'noxus': {
      const N = HERO_POWER.noxus;
      const from = () => scene.pointOf({ side: o.side, kind: 'hero' });
      const enemy = () => scene.pointOf({ side: o.side === 0 ? 1 : 0, kind: 'hero' });
      let pos: THREE.Vector3 = new THREE.Vector3();
      t.add(
        flyMesh(scene, makeAxe, () => ({ ...from(), y: 0.9 }), () => ({ ...enemy(), y: 0.7 }), N.travel, 0.9, (g, k) => {
          g.children[0].rotation.z = -k * Math.PI * 2 * N.spin;
          g.scale.setScalar(N.size * (1 + Math.sin(Math.PI * k) * 0.25));
          pos = g.position;
        }),
        0,
      );
      t.call(() => scene.particles.emit('slash_trail', { at: { ...from(), y: 0.9 }, follow: () => pos, color: 0xff8a70, count: 18, duration: N.travel }), undefined, 0.01);
      t.call(
        () => {
          const p = enemy();
          scene.particles.emit('spark_heavy', { at: { x: p.x, y: 0.6, z: p.z + 0.3 }, count: 16 });
          screenShake(scene, 1);
        },
        undefined,
        N.travel,
      );
      return t;
    }
    case 'ionia': {
      const I = HERO_POWER.ionia;
      const from = () => ({ ...o.from(), y: 0.6 });
      t.call(() => scene.particles.emit('fire_bolt', { at: from(), to: to(), color, duration: I.travel, scale: 1.2 }), undefined, 0);
      // 两颗绕着主弹转的小光球（阿狸的灵魄），沿主弹同一条弧线（fire_bolt 的 arc 0.9）
      for (const phase of [0, Math.PI]) {
        let a: Vec3 = { x: 0, y: 0, z: 0 };
        let b: Vec3 = a;
        const st = { k: 0 };
        const follow = () => {
          const p = arcPoint(a, b, st.k, BOLT_ARC * 1.2);
          const ang = phase + st.k * Math.PI * 4;
          return { x: p.x + Math.cos(ang) * 0.38, y: p.y + Math.sin(ang) * 0.28, z: p.z };
        };
        t.call(() => {
          a = from();
          b = to();
          st.k = 0;
          scene.particles.emit('fire_bolt', { at: from(), follow, color: 0xffc2f0, duration: I.travel, scale: 0.4 });
        }, undefined, 0);
        t.to(st, { k: 1, duration: I.travel, ease: 'none' }, 0);
      }
      t.call(() => scene.particles.emit('spark_light', { at: to(), color, count: 12, scale: 1.3 }), undefined, I.travel);
      return t;
    }
    case 'freljord': {
      const F = HERO_POWER.freljord;
      const from = () => ({ ...o.from(), y: 0.6 });
      t.call(() => scene.particles.emit('fire_bolt', { at: from(), to: to(), color, duration: F.travel, count: 26 }), undefined, 0);
      t.add(
        flyMesh(scene, makeIceArrow, from, to, F.travel, BOLT_ARC, (g, _k, dir) => {
          g.lookAt(g.position.clone().add(dir));
        }),
        0,
      );
      t.call(
        () => {
          const p = to();
          scene.particles.emit('frost_spread', { at: ground(p), count: 12, dir: 'out' });
          scene.particles.emit(frost_hit, { at: ground(p) });
        },
        undefined,
        F.travel,
      );
      return t;
    }
  }
}
