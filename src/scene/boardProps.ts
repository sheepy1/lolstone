// 棋盘上的几何体道具（M4 美术）：野区的岩石墙和灌木、河岸的卵石、草地上随风摆的草丛、台面外框、枢纽石台、石墩。
// 岩石和灌木是变形过的低模二十面体，按面上色（顶上长苔、底下压暗），同一类全部合并成一个网格，一次绘制；
// 草丛是 InstancedMesh，一次绘制，摆动在顶点着色器里做，不投影。
// 外框和枢纽 b、结束回合按钮同一套材质语言：暗色金属（0x2a2e34）加海克斯金的窄沿，外圈是深色石材。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { endTurnSlot, heroSlot, TABLE } from '../presentation/layout';
import { BOARD_ART } from './artStyle';
import { laneValue } from './boardTextures';
import { shared } from './dispose';
import { stoneMaterial } from './groundMaterial';
import { END_TURN_PIER, freedom, riverCenter, terrainHeight, WATER_LEVEL } from './terrain';

const GOLD = 0xc8aa6e;
const metalMat = shared(new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.45, metalness: 0.75 }));
const goldMat = shared(new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.32, metalness: 0.85 }));
// 外框的暗金属：和 metalMat 同色，带一点反射，倒角上看得出金属的亮边。metalMat 不加反射，用在四角墩顶上凹下的暗面
const frameMetal = shared(new THREE.MeshStandardMaterial({ color: 0xffffff, map: frameEngraving(), roughness: 0.34, metalness: 0.8 }));

// 外框金属上的暗纹：一串六边形刻线加横向拉丝，可平铺。挤出几何体的 uv 是形状坐标（台面单位），repeat 2 即每半个单位一格
function frameEngraving(): THREE.CanvasTexture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c3038';
  g.fillRect(0, 0, N, N);
  let s = 9;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < N; y++) {
    g.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`;
    g.fillRect(0, y, N, 1);
  }
  const r = N / 4;
  const hex = (cx: number, cy: number) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const x = cx + Math.cos(a) * r * 0.82;
      const y = cy + Math.sin(a) * r * 0.82;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  };
  for (const [cx, cy] of [[N / 2, N / 2], [0, 0], [N, 0], [0, N], [N, N]] as const) {
    hex(cx, cy);
    g.lineWidth = 2.5;
    g.strokeStyle = '#1a1d22';
    g.stroke();
    hex(cx + 1, cy + 1);
    g.lineWidth = 1;
    g.strokeStyle = '#4a505a';
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.anisotropy = 4;
  return shared(t);
}
const darkStone = stoneMaterial(0x34353a, 0.28);
const plinthStone = stoneMaterial(0x45464a, 0.6);

// 金色金属反射舞台的 reflections，和结束回合按钮一样；外框的暗金属也加一点
export function useBoardReflections(env: THREE.Texture): void {
  if (goldMat.envMap === env) return;
  goldMat.envMap = env;
  goldMat.envMapIntensity = 0.6;
  goldMat.needsUpdate = true;
  frameMetal.envMap = env;
  frameMetal.envMapIntensity = 0.45;
  frameMetal.needsUpdate = true;
}

// 可复现的伪随机
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// 三维值噪声，变形岩石用
function h3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const fx = f(x - ix);
  const fy = f(y - iy);
  const fz = f(z - iz);
  let s = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) s += h3(ix + dx, iy + dy, iz + dz) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
  return s;
}

type Blob = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; seed: number };

// 一块变形的低模石头（或灌木团），已经摆到世界坐标，带按面的颜色
function blob(b: Blob, detail: number, rough: number, paint: (n: THREE.Vector3, y01: number, r: () => number, p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 1.8 + b.seed, v.y * 1.8, v.z * 1.8) * 0.65 + noise3(v.x * 4 + b.seed, v.y * 4, v.z * 4) * 0.35;
    v.multiplyScalar(1 + (n - 0.5) * rough);
    // 底面压平，坐在地上
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(b.sx, b.sy, b.sz);
  g.rotateY(b.ry);
  g.translate(b.x, b.y, b.z);
  g.computeVertexNormals(); // 非索引几何体：每个面一个法线，低模的棱面
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const r = rng(b.seed * 7919);
  const n = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (let f = 0; f < pos.count; f += 3) {
    n.fromBufferAttribute(nrm, f);
    centre.fromBufferAttribute(pos, f).add(tmp.fromBufferAttribute(pos, f + 1)).add(tmp.fromBufferAttribute(pos, f + 2)).multiplyScalar(1 / 3);
    const y01 = (centre.y - (b.y - 0.35 * b.sy)) / (1.35 * b.sy);
    const c = paint(n, Math.min(1, Math.max(0, y01)), r, centre);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

const ROCK_A = new THREE.Color(0x58534a);
const ROCK_B = new THREE.Color(0x8a8173);
const MOSS = new THREE.Color(0x44582a);
// 颜色按位置的噪声平滑变化，每个面只带一点抖动：每面随机取色会碎成一片马赛克
const paintRock = (n: THREE.Vector3, y01: number, r: () => number, p: THREE.Vector3) => {
  const c = ROCK_A.clone().lerp(ROCK_B, noise3(p.x * 2.2, p.y * 2.2, p.z * 2.2) * 0.8 + r() * 0.2);
  if (n.y > 0.62) c.lerp(MOSS, Math.min(0.75, (n.y - 0.62) * 2.5) * noise3(p.x * 3 + 5, p.y * 3, p.z * 3));
  return c.multiplyScalar(0.55 + 0.45 * y01);
};
const LEAF_A = new THREE.Color(0x1c3a18);
const LEAF_B = new THREE.Color(0x36591f);
const paintLeaf = (n: THREE.Vector3, y01: number, r: () => number) => {
  const c = LEAF_A.clone().lerp(LEAF_B, Math.max(0, n.y) * 0.7 + r() * 0.3);
  return c.multiplyScalar(0.45 + 0.6 * y01);
};

// 野区的岩石墙：沿一条线排一串大小不一的岩石，两侧散几块碎石
const WALLS: [number, number, number, number][] = [
  [-9.7, -4.2, 3.0, 0.55],
  [-9.9, 3.6, 2.6, -0.4],
  [-8.9, 5.9, 1.6, 1.1],
  [-8.9, -6.0, 1.4, -1.0],
];
// 灌木丛：[x, z, 大小]
const BUSHES: [number, number, number][] = [
  [-9.0, -2.6, 1],
  [-10.3, -5.9, 0.8],
  [-8.6, 2.3, 0.9],
  [-10.3, 5.0, 0.85],
  [-8.2, -6.6, 0.7],
  [-5.6, -6.5, 0.75],
  [-3.4, -6.75, 0.6],
  [10.4, -5.4, 0.75],
  [10.3, 5.9, 0.7],
  [-6.4, 6.6, 0.7],
];

export function rocksAndBushes(): THREE.Group {
  const out = new THREE.Group();
  const rocks: THREE.BufferGeometry[] = [];
  const r = rng(11);
  let seed = 1;
  for (const [x, z, len, rot] of WALLS) {
    const n = Math.max(3, Math.round(len / 0.55));
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * len;
      const rx = x + Math.sin(rot) * t + (r() - 0.5) * 0.2;
      const rz = z + Math.cos(rot) * t + (r() - 0.5) * 0.2;
      const s = 0.42 + r() * 0.22;
      rocks.push(blob({ x: rx, y: terrainHeight(rx, rz) + s * 0.25, z: rz, sx: s * (1.1 + r() * 0.4), sy: s * (0.7 + r() * 0.5), sz: s * (0.9 + r() * 0.2), ry: rot + (r() - 0.5) * 0.8, seed: seed++ }, 2, 0.75, paintRock));
    }
    // 碎石
    for (let i = 0; i < 4; i++) {
      const t = (r() - 0.5) * len * 1.3;
      const off = (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.35);
      const rx = x + Math.sin(rot) * t + Math.cos(rot) * off;
      const rz = z + Math.cos(rot) * t - Math.sin(rot) * off;
      const s = 0.1 + r() * 0.12;
      rocks.push(blob({ x: rx, y: terrainHeight(rx, rz) + s * 0.2, z: rz, sx: s, sy: s * 0.7, sz: s * 1.2, ry: r() * 6, seed: seed++ }, 0, 0.4, paintRock));
    }
  }
  // 河岸的卵石：沿两岸水线零星几块，半截在水里
  for (let i = 0; i < 46; i++) {
    const x = -10.4 + r() * 20.8;
    if (Math.abs(x - endTurnSlot().pos.x) < 2.3) continue;
    const side = r() < 0.5 ? -1 : 1;
    const z = riverCenter(x) + side * (0.72 + r() * 0.5);
    if (freedom(x, z) < 0.5) continue;
    const s = 0.06 + r() * 0.1;
    rocks.push(blob({ x, y: Math.max(terrainHeight(x, z), WATER_LEVEL - 0.05) + s * 0.1, z, sx: s * 1.3, sy: s * 0.6, sz: s, ry: r() * 6, seed: seed++ }, 0, 0.35, paintRock));
  }
  const rockMesh = new THREE.Mesh(mergeGeometries(rocks), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true }));
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  out.add(rockMesh);

  const leaves: THREE.BufferGeometry[] = [];
  for (const [x, z, size] of BUSHES) {
    const k = 4 + Math.floor(r() * 3);
    for (let i = 0; i < k; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 0.32 * size;
      const bx = x + Math.cos(a) * d;
      const bz = z + Math.sin(a) * d;
      const s = (0.24 + r() * 0.14) * size;
      leaves.push(blob({ x: bx, y: terrainHeight(bx, bz) + s * 0.45 + (i === 0 ? 0.08 : 0), z: bz, sx: s * 1.1, sy: s * (0.8 + r() * 0.35), sz: s * 1.1, ry: r() * 6, seed: seed++ }, 1, 0.7, paintLeaf));
    }
  }
  const leafMesh = new THREE.Mesh(mergeGeometries(leaves), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  out.add(leafMesh);
  return out;
}

// ---------- 草丛 ----------

export type Tufts = THREE.InstancedMesh & { lolstoneTime: THREE.IUniform; lolstoneSway: THREE.IUniform };

function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const tip: number[] = [];
  const blades = 7;
  const r = rng(5);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + r() * 0.6;
    const lean = 0.25 + r() * 0.35;
    const h = 0.11 + r() * 0.1;
    const w = 0.022;
    const bx = Math.cos(a) * 0.03;
    const bz = Math.sin(a) * 0.03;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const tx = bx + Math.cos(a) * h * lean;
    const tz = bz + Math.sin(a) * h * lean;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz);
    const base = 0.35;
    col.push(base, base, base, base, base, base, 1, 1, 1);
    tip.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  // 法线全部朝上：草叶和地面受一样的光，不会因为朝向乱闪
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  return g;
}

export function grassTufts(): Tufts {
  const spots: [number, number][] = [];
  const r = rng(23);
  const W = TABLE.width / 2 - 0.25;
  const D = TABLE.depth / 2 - 0.25;
  for (let k = 0; k < 4000 && spots.length < 420; k++) {
    const x = (r() * 2 - 1) * W;
    const z = (r() * 2 - 1) * D;
    if (freedom(x, z) < 0.95) continue;
    if (laneValue(x, z) > 0.02) continue;
    if (Math.abs(z - riverCenter(x)) < 1.3) continue;
    if (terrainHeight(x, z) > 0.2) continue;
    spots.push([x, z]);
  }
  const time = { value: 0 };
  const sway = { value: BOARD_ART.sway };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.uniforms.uSway = sway;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTip;\nuniform float uTime;\nuniform float uSway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 ip = instanceMatrix[3].xz;
        float ph = uTime * 1.7 + ip.x * 0.9 + ip.y * 0.6;
        transformed.x += (sin(ph) * 0.6 + sin(ph * 2.3 + 1.0) * 0.4) * 0.025 * aTip * uSway;
        transformed.z += cos(ph * 0.8) * 0.012 * aTip * uSway;`,
      );
  };
  mat.customProgramCacheKey = () => 'lolstone-tuft-1';
  const mesh = new THREE.InstancedMesh(tuftGeometry(), mat, spots.length) as unknown as Tufts;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const dark = new THREE.Color(0x24451c);
  const light = new THREE.Color(0x587a2c);
  spots.forEach(([x, z], i) => {
    const s = 0.8 + r() * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, terrainHeight(x, z) - 0.005, z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.5), s));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.copy(dark).lerp(light, r()));
  });
  mesh.receiveShadow = true;
  mesh.lolstoneTime = time;
  mesh.lolstoneSway = sway;
  return mesh;
}

// ---------- 台面外框 ----------

// 切角矩形（海克斯的棱角），中心在原点
function chamferRect(w: number, d: number, c: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = w / 2;
  const y = d / 2;
  s.moveTo(-x + c, -y);
  s.lineTo(x - c, -y);
  s.lineTo(x, -y + c);
  s.lineTo(x, y - c);
  s.lineTo(x - c, y);
  s.lineTo(-x + c, y);
  s.lineTo(-x, y - c);
  s.lineTo(-x, -y + c);
  s.closePath();
  return s;
}

function ring(outer: THREE.Shape, inner: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  outer.holes.push(inner);
  const g = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // 挤出方向朝上
  return g;
}

function hexShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    // 和 CylinderGeometry 的六棱同向：顶点在 ±z
    const a = (i / 6) * Math.PI * 2;
    const x = Math.sin(a) * r;
    const y = -Math.cos(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function hexRing(outer: number, inner: number, depth: number): THREE.ExtrudeGeometry {
  return ring(hexShape(outer), hexShape(inner), depth, 0);
}

function add(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

export function tableFrame(): THREE.Group {
  const out = new THREE.Group();
  const { width: W, depth: D } = TABLE;
  // 外圈深色石台：围着地形的一圈，顶面在地形下面一点，侧面一直落到台下。中间是空的：河道比石台顶面低，
  // 实心的石台会从河床里露出来
  const slabShape = chamferRect(W + 2.0, D + 2.0, 1.0);
  slabShape.holes.push(chamferRect(W - 0.1, D - 0.1, 0.2));
  const slab = new THREE.ExtrudeGeometry(slabShape, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  slab.rotateX(-Math.PI / 2);
  add(out, slab, darkStone, 0, -1.36, 0);
  // 暗金属框：压住地形的边缘，切角
  const frame = ring(chamferRect(W + 0.86, D + 0.86, 0.62), chamferRect(W - 0.04, D - 0.04, 0.2), 0.12, 0.05);
  add(out, frame, frameMetal, 0, -0.04, 0);
  // 内沿一道海克斯金
  const lip = ring(chamferRect(W + 0.14, D + 0.14, 0.26), chamferRect(W - 0.04, D - 0.04, 0.2), 0.035, 0.012);
  add(out, lip, goldMat, 0, 0.12, 0, false);
  // 外沿一道细金线
  const outerLip = ring(chamferRect(W + 0.9, D + 0.9, 0.64), chamferRect(W + 0.76, D + 0.76, 0.58), 0.03, 0.01);
  add(out, outerLip, goldMat, 0, 0.115, 0, false);
  // 四角的六棱金属墩，顶上金沿，中间一块凹下的暗面
  const capGeo = new THREE.CylinderGeometry(0.62, 0.72, 0.36, 6);
  const capLip = hexRing(0.62, 0.5, 0.04);
  const capTop = new THREE.CylinderGeometry(0.5, 0.5, 0.02, 6);
  const gemGeo = new THREE.OctahedronGeometry(0.16, 0);
  gemGeo.scale(1, 0.55, 1);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (W / 2 + 0.28);
      const z = sz * (D / 2 + 0.28);
      add(out, capGeo, frameMetal, x, 0.02, z);
      add(out, capLip, goldMat, x, 0.2, z, false);
      add(out, capTop, metalMat, x, 0.19, z, false);
      add(out, gemGeo, goldMat, x, 0.24, z);
    }
  }
  // 左右两端河道出口：一块金属闸板，两枚金色箭头指向河道
  const plate = new THREE.ExtrudeGeometry(chamferRect(0.5, 1.5, 0.22), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1 });
  plate.rotateX(-Math.PI / 2);
  const chev = new THREE.Shape();
  chev.moveTo(-0.1, -0.14);
  chev.lineTo(0.06, 0);
  chev.lineTo(-0.1, 0.14);
  chev.lineTo(-0.04, 0);
  chev.closePath();
  const chevGeo = new THREE.ExtrudeGeometry(chev, { depth: 0.02, bevelEnabled: false });
  chevGeo.rotateX(-Math.PI / 2);
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.22);
    const z = riverCenter(sx * (W / 2));
    add(out, plate, frameMetal, x, 0.07, z);
    for (const dz of [-0.42, 0.42]) {
      const m = add(out, chevGeo, goldMat, x - sx * 0.02, 0.15, z + dz, false);
      m.rotation.y = sx > 0 ? Math.PI : 0;
    }
  }
  // 台下的地面
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ color: 0x080c0b, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.4;
  floor.receiveShadow = true;
  out.add(floor);
  return out;
}

// 枢纽脚下的六棱石台（顶上一圈金沿）和结束回合按钮脚下的石墩
export function plinths(): THREE.Group {
  const out = new THREE.Group();
  const plinth = new THREE.CylinderGeometry(1.75, 1.95, 0.3, 6);
  const lip = hexRing(1.76, 1.66, 0.03);
  for (const p of ['near', 'far'] as const) {
    const h = heroSlot(p).pos;
    add(out, plinth, plinthStone, h.x, -0.12, h.z);
    add(out, lip, goldMat, h.x, 0.025, h.z, false);
  }
  const e = endTurnSlot().pos;
  const P = END_TURN_PIER;
  const pier = add(out, new THREE.CylinderGeometry(P.rTop, P.rBottom, P.height, 6), plinthStone, e.x, P.top - P.height / 2, e.z);
  pier.scale.x = P.scaleX;
  return out;
}
