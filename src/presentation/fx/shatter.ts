// 随从碎裂（m4-storyboard E14）：底座连同顶面的头像切成 n × n 块（默认 9 块），每块是带厚度的小方块，顶面贴着对应的那一片
// 头像（去饱和、压暗，和定格时一样），侧面是底座的颜色；带重力向外、向上飞散并翻滚，落到台面就停在台面上，最后淡出。
// 不改 MinionView：头像贴图和底座颜色从它的网格上读。碎块的几何体和材质归这一次碎裂，播完释放；去饱和的头像贴图按
// 原贴图缓存、多局共用。
import gsap from 'gsap';
import * as THREE from 'three';
import { MINION_BASE, MINION_TOP } from '../../scene/geometry';
import type { MinionView } from '../../scene/minionView';
import { shared } from '../../scene/dispose';
import { MINION_HEIGHT, MINION_SIZE } from '../layout';

export type ShatterOptions = {
  pieces: number; // 每边切几块
  speed: number;
  up: number;
  gravity: number;
  spin: number;
  duration: number; // 飞散
  fade: number; // 飞散之后淡出
  brightness: number; // 头像亮度
};

const greyCache = new Map<string, THREE.CanvasTexture>();

// 去饱和、压暗的头像（定格和碎块共用）。原贴图的图像后来重画过（头像图加载好）时按 version 重新生成
export function greyPortrait(tex: THREE.Texture, brightness: number): THREE.Texture {
  const key = `${tex.uuid}|${tex.version}|${brightness}`;
  const hit = greyCache.get(key);
  if (hit) return hit;
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img?.width || 256;
  c.height = img?.height || 256;
  const g = c.getContext('2d')!;
  g.filter = `grayscale(1) brightness(${brightness})`;
  if (img) g.drawImage(img, 0, 0, c.width, c.height);
  const out = shared(new THREE.CanvasTexture(c));
  out.colorSpace = THREE.SRGBColorSpace;
  greyCache.set(key, out);
  return out;
}

function meshBy(m: MinionView, geo: THREE.BufferGeometry): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  m.body.traverse((o) => {
    if (!found && (o as THREE.Mesh).geometry === geo) found = o as THREE.Mesh;
  });
  return found;
}

// 定格：头像换成去饱和的那张。返回恢复函数（随从马上要被移走，一般用不到）
export function greyOut(m: MinionView, brightness: number): void {
  const top = meshBy(m, MINION_TOP);
  const mat = top?.material as THREE.MeshStandardMaterial | undefined;
  if (!mat?.map) return;
  mat.map = greyPortrait(mat.map, brightness);
  mat.color.setScalar(1);
  mat.needsUpdate = true;
}

// 碎块的几何体：按 n × n 切好、顶面 uv 对好的一组小方块，所有碎裂共用（每次新建几何体要往显卡传一次缓冲，
// 14 个随从同时死时会卡一帧）。切线带一点固定的错位，碎块大小不一
const pieceSets = new Map<number, { geo: THREE.BoxGeometry; cx: number; cz: number; h: number }[]>();
function piecesOf(n: number) {
  let set = pieceSets.get(n);
  if (set) return set;
  const S = MINION_SIZE;
  const art = MINION_SIZE - 0.2; // 头像面片的边长
  const jitter = [0, 0.22, -0.18, 0.15, -0.2, 0.1];
  const cuts = (k: number): number[] => {
    const xs = [-S / 2];
    for (let i = 1; i < n; i++) xs.push(-S / 2 + (S * i) / n + jitter[(i + k) % jitter.length] * (S / n));
    xs.push(S / 2);
    return xs;
  };
  const xs = cuts(0);
  const zs = cuts(2);
  set = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const w = xs[i + 1] - xs[i];
      const d = zs[j + 1] - zs[j];
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      const h = MINION_HEIGHT * (0.85 + (((i * 7 + j * 3) % 5) / 4) * 0.3);
      const geo = shared(new THREE.BoxGeometry(w * 0.96, h, d * 0.96));
      // 顶面（+y，第 2 组，顶点 8 到 11）的 uv 对到头像上对应的那一片
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 8; k < 12; k++) uv.setXY(k, (cx + pos.getX(k) + art / 2) / art, 1 - (cz + pos.getZ(k) + art / 2) / art);
      // 方块默认六个面各一组、各画一次；改成两组（顶面一组、其余一组），14 个随从同时碎时少画几百次
      const idx = geo.getIndex()!;
      const tris = Array.from(idx.array as ArrayLike<number>);
      const top = tris.slice(12, 18); // +y 面的 6 个索引（每面 2 个三角形）
      const rest = [...tris.slice(0, 12), ...tris.slice(18)];
      geo.setIndex([...top, ...rest]);
      geo.clearGroups();
      geo.addGroup(0, 6, 1);
      geo.addGroup(6, rest.length, 0);
      set.push({ geo, cx, cz, h });
    }
  }
  pieceSets.set(n, set);
  return set;
}

export function shatterMinion(layer: THREE.Object3D, m: MinionView, o: ShatterOptions): void {
  m.updateWorldMatrix(true, true);
  const world = m.body.matrixWorld.clone();
  const topMat = meshBy(m, MINION_TOP)?.material as THREE.MeshStandardMaterial | undefined;
  const baseMat = meshBy(m, MINION_BASE)?.material as THREE.MeshStandardMaterial | undefined;
  // 材质参数和随从自己的底座、头像一样（不透明），用的是已经编译好的着色器；新的组合（比如透明）第一次用时要现编译，
  // 实测第一次碎裂卡 60ms。所以淡出改成碎块缩小
  const sideMat = new THREE.MeshStandardMaterial({ color: baseMat?.color ?? 0x3a4a5c, roughness: 0.7, metalness: 0.25 });
  const faceMat = new THREE.MeshStandardMaterial({ map: topMat?.map ?? null, roughness: 0.6, metalness: 0.05 });
  const mats = [sideMat, faceMat];
  type Piece = { mesh: THREE.Mesh; p0: THREE.Vector3; v: THREE.Vector3; axis: THREE.Vector3; w: number; q0: THREE.Quaternion; half: number; land: number };
  const pieces: Piece[] = [];
  const group = new THREE.Group();
  const center = new THREE.Vector3().set(0, MINION_HEIGHT / 2, 0).applyMatrix4(world);
  const q0 = new THREE.Quaternion().setFromRotationMatrix(world);
  for (const c of piecesOf(Math.max(2, Math.round(o.pieces)))) {
    // 不投影：满场同时碎时投影要再画一遍几百块，碎块又小又快，看不出差别
    const mesh = new THREE.Mesh(c.geo, mats);
    const p0 = new THREE.Vector3(c.cx, c.h / 2, c.cz).applyMatrix4(world);
    const out = new THREE.Vector3(p0.x - center.x, 0, p0.z - center.z);
    if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    out.normalize().multiplyScalar(o.speed * (0.6 + Math.random() * 0.7));
    const v = new THREE.Vector3(out.x, o.up * (0.7 + Math.random() * 0.6), out.z);
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    mesh.position.copy(p0);
    mesh.quaternion.copy(q0);
    group.add(mesh);
    // 落到台面的时刻：p0.y + v.y t - g t² / 2 = h / 2
    const half = c.h / 2;
    const land = (v.y + Math.sqrt(v.y * v.y + 2 * o.gravity * Math.max(0, p0.y - half))) / o.gravity;
    pieces.push({ mesh, p0, v, axis, w: o.spin * (0.4 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1), q0, half, land });
  }
  layer.add(group);
  const st = { t: 0 };
  const total = o.duration + o.fade;
  const q = new THREE.Quaternion();
  const release = () => {
    group.removeFromParent();
    sideMat.dispose();
    faceMat.dispose();
  };
  gsap.to(st, {
    t: total,
    duration: total,
    ease: 'none',
    onUpdate: () => {
      const t = st.t;
      // 飞散的后段开始缩小，淡出结束时缩没
      const k = t < o.duration * 0.6 ? 1 : Math.max(0.001, 1 - (t - o.duration * 0.6) / (total - o.duration * 0.6));
      for (const p of pieces) {
        // 落地后在台面上滑一小段就停（水平速度只剩三成、再衰减），不再翻滚
        const air = Math.min(t, p.land);
        const slide = t > p.land ? (0.3 * (1 - Math.exp(-(t - p.land) * 6))) / 6 : 0;
        const y = p.p0.y + p.v.y * air - 0.5 * o.gravity * air * air;
        p.mesh.position.set(p.p0.x + p.v.x * (air + slide), Math.max(p.half * k, y), p.p0.z + p.v.z * (air + slide));
        p.mesh.quaternion.copy(p.q0).premultiply(q.setFromAxisAngle(p.axis, p.w * air));
        p.mesh.scale.setScalar(k);
      }
    },
    onComplete: release,
    onInterrupt: release,
  });
}
