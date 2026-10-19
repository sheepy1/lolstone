// 棋盘（spec 5.2）：浮雕低模。细分平面按高度场（terrain.ts）位移出地形，顶点着色区分草地、兵线、河床和山石；
// 河道里一层水面，法线贴图缓慢流动；枢纽脚下是六棱石台，左侧野区几段石墙，结束回合按钮立在河中的石墩上。
// 都是几何体加程序生成的贴图，不需要外部建模素材。卡牌和随从的影子落在真实的起伏上。
import * as THREE from 'three';
import { boardSlot, endTurnSlot, heroSlot, TABLE } from '../presentation/layout';
import { riverCenter, terrainHeight, valueNoise, WATER_LEVEL } from './terrain';

const SEG_X = 176;
const SEG_Z = 116;

const c = (hex: number) => new THREE.Color(hex);
const GRASS_A = c(0x2a5530);
const GRASS_B = c(0x3f6f3a);
const LANE = c(0x6b5a3a);
const BED = c(0x2c3a30);
const BANK = c(0x5a4a32);
const ROCK = c(0x6c6a60);

function laneMask(x: number, z: number): number {
  let m = 0;
  for (const rz of [boardSlot('near', 0, 1).pos.z, boardSlot('far', 0, 1).pos.z]) {
    const dz = Math.abs(z - rz);
    if (Math.abs(x) < 7.4 && dz < 1.05) m = Math.max(m, 1 - Math.max(0, dz - 0.75) / 0.3);
  }
  return m;
}

function terrainGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(TABLE.width, TABLE.depth, SEG_X, SEG_Z);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    col.copy(GRASS_A).lerp(GRASS_B, valueNoise(x * 0.8, z * 0.8));
    col.lerp(LANE, laneMask(x, z) * 0.45);
    if (h < -0.04) col.lerp(BANK, Math.min(1, -h / 0.15)).lerp(BED, Math.min(1, Math.max(0, (-h - 0.15) / 0.2)));
    if (h > 0.12) col.lerp(BANK, Math.min(1, (h - 0.12) / 0.25)).lerp(ROCK, Math.min(1, Math.max(0, (h - 0.4) / 0.4)));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// 细碎的明暗噪点，铺满地面增加颗粒感
function detailTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 200 + Math.floor(valueNoise((i % 256) * 0.35, Math.floor(i / 256) * 0.35) * 55);
    img.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 7);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 水面的法线贴图：两层噪声求梯度
function waterNormals(): THREE.CanvasTexture {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(N, N);
  const hgt = (x: number, y: number) => valueNoise(x * 0.06, y * 0.06) + 0.5 * valueNoise(x * 0.15 + 9, y * 0.15 + 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y);
      const dy = hgt(x, y + 1) - hgt(x, y - 1);
      const n = new THREE.Vector3(-dx * 3, -dy * 3, 1).normalize();
      img.data.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], (y * N + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 1.2);
  return t;
}

export class BoardView extends THREE.Group {
  private readonly water: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

  constructor() {
    super();
    const { width: W, depth: D } = TABLE;
    const ground = new THREE.Mesh(
      terrainGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTexture(), roughness: 0.92, metalness: 0, flatShading: true }),
    );
    ground.receiveShadow = true;
    this.add(ground);

    // 台面的侧壁和底座：顶面不画（地形就是顶面），只留四周和底面，给台面厚度
    const side = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8, metalness: 0.1 });
    const none = new THREE.MeshBasicMaterial({ visible: false });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 1.3, D), [side, side, none, side, side, side]);
    slab.position.y = -0.65;
    slab.castShadow = true;
    this.add(slab);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.45, metalness: 0.6 });
    const rail = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), frameMat);
      m.position.set(x, 0.05, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.add(m);
    };
    rail(W + 0.3, 0.3, 0, D / 2);
    rail(W + 0.3, 0.3, 0, -D / 2);
    rail(0.3, D, W / 2, 0);
    rail(0.3, D, -W / 2, 0);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ color: 0x0c1410, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    floor.receiveShadow = true;
    this.add(floor);

    // 河水
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 3.4, 64, 1),
      new THREE.MeshStandardMaterial({
        color: 0x1d6a85,
        roughness: 0.12,
        metalness: 0.15,
        transparent: true,
        opacity: 0.82,
        normalMap: waterNormals(),
        normalScale: new THREE.Vector2(0.5, 0.5),
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_LEVEL;
    this.water.receiveShadow = true;
    // 水面跟着河道弯
    const wp = this.water.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < wp.count; i++) wp.setY(i, wp.getY(i) - riverCenter(wp.getX(i)));
    this.add(this.water);

    const stone = new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.85, metalness: 0.05, flatShading: true });
    // 枢纽脚下的六棱石台
    for (const p of ['near', 'far'] as const) {
      const h = heroSlot(p).pos;
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.95, 0.3, 6), stone);
      plinth.position.set(h.x, -0.12, h.z);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      this.add(plinth);
    }
    // 结束回合按钮立在河中的石墩上
    const e = endTurnSlot().pos;
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.8, 0.6, 8), stone);
    pier.position.set(e.x, -0.28, e.z);
    pier.castShadow = true;
    pier.receiveShadow = true;
    this.add(pier);
    // 左侧野区的几段石墙：一串大小不一的低模石块
    const walls: [number, number, number, number][] = [
      [-9.7, -4.2, 3.0, 0.55],
      [-9.9, 3.6, 2.6, -0.4],
      [-8.9, 5.9, 1.6, 1.1],
      [-8.9, -6.0, 1.4, -1.0],
    ];
    const rockGeo = new THREE.DodecahedronGeometry(0.42, 0);
    let k = 0;
    for (const [x, z, len, rot] of walls) {
      const n = Math.max(3, Math.round(len / 0.5));
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * len;
        const rx = x + Math.sin(rot) * t;
        const rz = z + Math.cos(rot) * t;
        const rnd = (j: number) => valueNoise(k * 3.1 + j, i * 1.7 + j * 5);
        const rock = new THREE.Mesh(rockGeo, stone);
        rock.position.set(rx + (rnd(1) - 0.5) * 0.25, terrainHeight(rx, rz) + 0.12, rz + (rnd(2) - 0.5) * 0.25);
        rock.scale.set(0.8 + rnd(3) * 0.6, 0.6 + rnd(4) * 0.7, 0.8 + rnd(5) * 0.6);
        rock.rotation.set(rnd(6) * 3, rnd(7) * 3, rnd(8) * 3);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.add(rock);
      }
      k++;
    }
  }

  tick(t: number): void {
    const n = this.water.material.normalMap!;
    n.offset.set(t * 0.012, t * 0.004);
  }
}
