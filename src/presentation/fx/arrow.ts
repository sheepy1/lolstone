// 目标箭头（spec 5.3）：从来源拉出一条贴着台面拱起的红色 3D 曲线（TubeGeometry），箭头头部是圆锥，
// 指到合法目标上时头部套一个准星环。几何体每次移动重建，段数少，开销很小。
import * as THREE from 'three';
import type { Vec3 } from '../layout';
import { glowMaterial, markBloom } from './materials';

export type Point = Vec3;

export class TargetArrow extends THREE.Group {
  private tube: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial> | null = null;
  private readonly head: THREE.Mesh;
  private readonly reticle: THREE.Mesh;
  private readonly mat = glowMaterial(0xff3b3b, 2.0);
  private from = new THREE.Vector3();

  constructor() {
    super();
    this.head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 16), this.mat);
    this.reticle = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.06, 8, 40), this.mat);
    this.reticle.rotation.x = -Math.PI / 2;
    this.add(this.head, this.reticle);
    markBloom(this);
    this.visible = false;
    this.renderOrder = 10;
  }

  start(from: Vec3, color = 0xff3b3b): void {
    this.mat.color.setHex(color).multiplyScalar(2.0);
    this.from.set(from.x, from.y, from.z);
    this.visible = true;
    this.update(from, false);
  }

  update(to: Vec3, onTarget = false): void {
    if (!this.visible) return;
    const a = this.from;
    const b = new THREE.Vector3(to.x, Math.max(to.y, 0.35), to.z);
    const len = a.distanceTo(b);
    if (this.tube) {
      this.remove(this.tube);
      this.tube.geometry.dispose();
      this.tube = null;
    }
    this.head.visible = len > 0.3;
    this.reticle.visible = onTarget;
    this.reticle.position.set(b.x, 0.08, b.z);
    if (len < 0.3) return;
    // 控制点在中间往上抬，抬高随距离增加
    const mid = a.clone().lerp(b, 0.5);
    mid.y += 1.2 + len * 0.25;
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b);
    this.tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.07, 6, false), this.mat);
    markBloom(this.tube);
    this.add(this.tube);
    const tangent = curve.getTangent(1).normalize();
    this.head.position.copy(b);
    this.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  }

  stop(): void {
    this.visible = false;
    if (this.tube) {
      this.remove(this.tube);
      this.tube.geometry.dispose();
      this.tube = null;
    }
  }
}
