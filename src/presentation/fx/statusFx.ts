// 随从身上常驻状态的进入和退出（m4-storyboard E18 圣盾、E19 潜行、E16 沉默；冻结在 iceShell.ts）。
// 常驻状态本身（外壳、烟、护盾环）归 MinionView，按显示局面显示或隐藏；这里只做"从无到有"和"从有到无"的过程，
// 每个函数在调用的那一刻开始播，自己管自己的补间。
import gsap from 'gsap';
import * as THREE from 'three';
import { MINION_BASE, MINION_TOP } from '../../scene/geometry';
import type { MinionView } from '../../scene/minionView';
import { drawKeywordIcon } from '../../scene/canvasArt';
import { releaseTexture, shared } from '../../scene/dispose';
import { fresnelMaterial, hdr } from './materials';

// 潜行时底座和头像的透明度（m4-storyboard E19），MinionView 的常驻状态也用它
export const STEALTH_OPACITY = 0.55;

// 获得圣盾：外壳 0 → over → 1（弹），护盾环收拢亮起
export function shieldGain(m: MinionView, duration: number, over: number, ringTime: number): void {
  const s = m.shell;
  s.visible = true;
  const base = { x: 1.15, y: 0.7 };
  const st = { k: 0 };
  const apply = () => s.scale.set(base.x * st.k, base.y * st.k, base.x * st.k);
  gsap.killTweensOf(st);
  const t = gsap.timeline();
  t.to(st, { k: over, duration: duration * 0.6, ease: 'power2.out', onUpdate: apply });
  t.to(st, { k: 1, duration: duration * 0.4, ease: 'back.out(1.4)', onUpdate: apply });
  m.badges.health.flashShield(ringTime);
}

// 和圣盾外壳同一组着色器参数（颜色是 uniform），不用为碎片另外编译着色器
const shardMat = fresnelMaterial(hdr(0xfff2b0, 2.2));

// 打破圣盾：外壳裂成 6 片向外飞散、淡出；护盾环放大熄灭。外壳本身马上藏起来
export function shieldShatter(layer: THREE.Object3D, m: MinionView, duration: number, speed: number): void {
  m.updateWorldMatrix(true, true);
  const world = m.shell.matrixWorld.clone();
  const center = new THREE.Vector3().setFromMatrixPosition(world);
  m.shell.visible = false;
  m.badges.health.breakShield();
  const group = new THREE.Group();
  const mat = shardMat.clone();
  const color = (mat.uniforms.color.value as THREE.Color).clone();
  mat.uniforms.color.value = color;
  const shards: { mesh: THREE.Mesh; dir: THREE.Vector3; spin: number }[] = [];
  for (let i = 0; i < 6; i++) {
    // 每片是外壳的一瓣：经度上 60°，纬度上半球
    const geo = new THREE.SphereGeometry(1, 8, 6, (i * Math.PI) / 3, Math.PI / 3, 0, Math.PI * 0.62);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = true;
    world.decompose(mesh.position, mesh.quaternion, mesh.scale);
    const mid = (i + 0.5) * (Math.PI / 3);
    const dir = new THREE.Vector3(Math.sin(mid), 0.55, Math.cos(mid)).normalize();
    shards.push({ mesh, dir, spin: (Math.random() - 0.5) * 6 });
    group.add(mesh);
  }
  layer.add(group);
  const st = { t: 0 };
  const scale0 = shards[0]?.mesh.scale.clone() ?? new THREE.Vector3(1, 1, 1);
  const release = () => {
    group.removeFromParent();
    for (const s of shards) s.mesh.geometry.dispose();
    mat.dispose();
  };
  gsap.to(st, {
    t: 1,
    duration,
    ease: 'power2.out',
    onUpdate: () => {
      for (const s of shards) {
        s.mesh.position.copy(center).addScaledVector(s.dir, speed * duration * st.t);
        s.mesh.rotation.y += s.spin * 0.016;
        s.mesh.scale.copy(scale0).multiplyScalar(1 + st.t * 0.25);
      }
      color.copy(hdr(0xfff2b0, 2.2 * (1 - st.t)));
    },
    onComplete: release,
    onInterrupt: release,
  });
}

// 底座和头像的材质（潜行时改透明度）
function bodyMaterials(m: MinionView): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  m.body.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g === MINION_BASE || g === MINION_TOP) out.push((o as THREE.Mesh).material as THREE.MeshStandardMaterial);
  });
  return out;
}

// 潜行进入：透明度 1 → 0.55，烟幕淡入。MinionView 已经按显示局面切到潜行（透明度直接是 0.55），这里从 1 补间过去
export function stealthFadeIn(m: MinionView, duration: number): void {
  for (const mat of bodyMaterials(m)) {
    mat.transparent = true;
    gsap.fromTo(mat, { opacity: 1 }, { opacity: STEALTH_OPACITY, duration, ease: 'power2.out' });
  }
  const sm = m.smoke.material;
  m.smoke.visible = true;
  gsap.fromTo(sm, { opacity: 0 }, { opacity: 0.55, duration, ease: 'power2.out' });
}

// 失去潜行：透明度回到 1，烟幕淡出。MinionView 已经切回不透明，这里先放回半透明再补间
export function stealthFadeOut(m: MinionView, duration: number): void {
  for (const mat of bodyMaterials(m)) {
    mat.transparent = true;
    gsap.fromTo(mat, { opacity: STEALTH_OPACITY }, { opacity: 1, duration, ease: 'power2.out', onComplete: () => void (mat.transparent = false) });
  }
  const sm = m.smoke.material;
  m.smoke.visible = true;
  gsap.fromTo(sm, { opacity: 0.55 }, { opacity: 0, duration, ease: 'power1.in', onComplete: () => void ((m.smoke.visible = false), (sm.opacity = 0.55)) });
}

// 沉默：嘲讽金边、潜行烟、圣盾外壳在 duration 内收缩消失（护盾环由 breakShield 收掉）（显示局面随后把它们藏起来，这里只做收缩的过程）
export function stripStatus(m: MinionView, duration: number): void {
  const targets: THREE.Object3D[] = [m.shell, m.smoke, m.tauntRim];
  if (m.shell.visible) m.badges.health.breakShield();
  for (const o of targets) {
    if (!o.visible) continue;
    const s0 = o.scale.clone();
    gsap.to(o.scale, {
      x: s0.x * 0.01,
      y: s0.y * 0.01,
      z: s0.z * 0.01,
      duration,
      ease: 'power2.in',
      onComplete: () => {
        o.visible = false;
        o.scale.copy(s0);
      },
    });
  }
}


type Cell = { x: number; y: number; z: number; size: number };
const cellGeo = shared(new THREE.PlaneGeometry(1, 1));

// 关键词图标的出现和消失（spec 5.4 潜行的"视野被遮"图标，E19）。底座上沿那排图标是一张 canvas，单个格子没法单独淡入淡出，
// 所以在那一格上叠一张同样的图标：
// - in：从 1.8 倍大、透明压到原位，像盖章（那一格本身已经画上了图标，叠层落定后正好重合）；
// - out：那一格已经擦掉了，叠层从原位缩小、淡出。cell 要在显示局面同步之前取（同步后那一格就没了）
export function keywordStamp(m: MinionView, k: string, cell: Cell | null, mode: 'in' | 'out', duration: number): void {
  if (!cell) return;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,10,14,0.92)';
  g.beginPath();
  g.roundRect(2, 2, 124, 124, 22);
  g.fill();
  const drawn = drawKeywordIcon(g, k, 10, 10, 108, 108, 16, () => {});
  if (!drawn) {
    g.fillStyle = '#9090b0';
    g.beginPath();
    g.roundRect(10, 10, 108, 108, 16);
    g.fill();
  }
  g.strokeStyle = '#c8aa6e';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(10, 10, 108, 108, 16);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(cellGeo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cell.x, cell.y + 0.006, cell.z);
  mesh.renderOrder = 3;
  m.body.add(mesh);
  const st = { k: mode === 'in' ? 0 : 1 };
  const apply = () => {
    const s = mode === 'in' ? 1 + (1 - st.k) * 0.8 : 0.4 + st.k * 0.6;
    mesh.scale.setScalar(cell.size * s);
    mat.opacity = st.k;
  };
  apply();
  const release = () => {
    mesh.removeFromParent();
    releaseTexture(tex);
    mat.dispose();
  };
  gsap.to(st, { k: mode === 'in' ? 1 : 0, duration, ease: mode === 'in' ? 'power2.out' : 'power1.in', onUpdate: apply, onComplete: release, onInterrupt: release });
}
