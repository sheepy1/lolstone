// 触发效果的指向光线（m4-storyboard E08）：从来源到目标一条贴着台面拱起的发光曲线，头部先到、身体后补，
// 命中处闪一下，然后淡出。造型跟玩家拖的目标箭头（arrow.ts）一致：TubeGeometry 加圆锥头，拱起高度同样随距离增加；
// 颜色用海克斯金，和表示伤害的红色箭头区分开。这里只是事件播放时的演示，不接受输入。
import gsap from 'gsap';
import * as THREE from 'three';
import { glowMaterial, markBloom } from './materials';

type Vec3 = { x: number; y: number; z: number };

const SEGMENTS = 32;
const RADIAL = 6;

export const BEAM = {
  grow: 0.15, // 拉出（落）：头部先到
  hit: 0.08, // 命中闪
  fade: 0.17, // 消失（飘的消失段）
};

// 返回时间线和命中时刻（相对时间线开头）。from、to 在时间线开始时取，跟上正在动的物件
export function beam(layer: THREE.Object3D, from: () => Vec3, to: () => Vec3, color = 0xffd070): { tl: gsap.core.Timeline; hitAt: number } {
  const t = gsap.timeline();
  const mat = glowMaterial(color, 2.2);
  mat.transparent = true;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 14), mat);
  const group = new THREE.Group();
  let tube: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial> | null = null;
  let curve: THREE.QuadraticBezierCurve3 | null = null;
  const st = { k: 0, a: 1 };
  const apply = () => {
    if (!tube || !curve) return;
    // 管子的三角形是沿长度依次排的，只画前 k 段就是"身体后补"
    tube.geometry.setDrawRange(0, Math.floor(st.k * SEGMENTS) * RADIAL * 6);
    head.position.copy(curve.getPoint(st.k));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(Math.min(1, Math.max(0.001, st.k))).normalize());
    mat.opacity = st.a;
  };
  t.call(() => {
    const a0 = from();
    const b0 = to();
    const a = new THREE.Vector3(a0.x, Math.max(a0.y, 0.35), a0.z);
    const b = new THREE.Vector3(b0.x, Math.max(b0.y, 0.35), b0.z);
    const len = a.distanceTo(b);
    const mid = a.clone().lerp(b, 0.5);
    mid.y += 1.2 + len * 0.25;
    curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    tube = new THREE.Mesh(new THREE.TubeGeometry(curve, SEGMENTS, 0.06, RADIAL, false), mat);
    group.add(tube, head);
    markBloom(group);
    layer.add(group);
    st.k = 0;
    st.a = 1;
    apply();
  });
  // 拉出（落）：头部 150ms 到目标
  t.to(st, { k: 1, duration: BEAM.grow, ease: 'power2.out', onUpdate: apply });
  const hitAt = BEAM.grow;
  // 命中闪之后消失（飘的消失段）
  t.to(st, { a: 0, duration: BEAM.fade, ease: 'power1.in', onUpdate: apply }, hitAt + BEAM.hit);
  t.call(() => {
    group.removeFromParent();
    tube?.geometry.dispose();
    head.geometry.dispose();
    mat.dispose();
  });
  return { tl: t, hitAt };
}
