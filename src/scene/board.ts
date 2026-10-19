// 棋盘（spec 5.2、5.4，M4 美术）：召唤师峡谷的俯视风格，程序化生成，不依赖外部贴图。
// - 地形：细分平面按高度场（terrain.ts）位移；表面由 groundMaterial.ts 的着色器按遮罩和噪声混出草地、土路、
//   湿泥卵石、河床、山石，程序纹理（boardTextures.ts）加载时生成一次；
// - 河水：半透明，深浅随水深变，两层法线反向流动，反射舞台的 reflections，岸边一圈白沫；河床上有焦散亮纹；
// - 道具（boardProps.ts）：野区岩石墙和灌木、河岸卵石、草丛、暗金属加深色石材的台面外框、枢纽石台、石墩。
// 外圈压暗、整体压饱和度，棋盘不抢中间随从和卡牌的戏。旧版在 boardLegacy.ts（?art=old）。
import * as THREE from 'three';
import { TABLE } from '../presentation/layout';
import { BOARD_ART } from './artStyle';
import { boardTextures } from './boardTextures';
import { grassTufts, plinths, rocksAndBushes, tableFrame, type Tufts } from './boardProps';
import { groundMaterial, waterMaterial, type GroundMaterial, type WaterMaterial } from './groundMaterial';
import { riverCenter, terrainHeight, WATER_LEVEL } from './terrain';

const SEG_X = 220;
const SEG_Z = 144;

function terrainGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(TABLE.width, TABLE.depth, SEG_X, SEG_Z);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

// 河水：沿河道弯曲的长条，每个顶点记下水深（水面到河床），着色器按它变深浅、出白沫
function waterGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(TABLE.width, 3.0, 176, 24);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) + riverCenter(x);
    pos.setZ(i, z);
    depth[i] = WATER_LEVEL - terrainHeight(x, z);
  }
  g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  return g;
}

export class BoardView extends THREE.Group {
  private readonly groundMat: GroundMaterial;
  private readonly waterMat: WaterMaterial;
  private readonly tufts: Tufts;

  constructor() {
    super();
    const tex = boardTextures();
    this.groundMat = groundMaterial(tex);
    const ground = new THREE.Mesh(terrainGeometry(), this.groundMat);
    ground.receiveShadow = true;
    this.add(ground);

    this.waterMat = waterMaterial(tex);
    const water = new THREE.Mesh(waterGeometry(), this.waterMat);
    water.position.y = WATER_LEVEL;
    water.receiveShadow = true;
    this.add(water);

    this.add(tableFrame(), plinths(), rocksAndBushes());
    this.tufts = grassTufts();
    this.add(this.tufts);
  }

  // 舞台的反射贴图：水面反光用
  useReflections(env: THREE.Texture): void {
    this.waterMat.envMap = env;
    this.waterMat.needsUpdate = true;
  }

  tick(t: number): void {
    const g = this.groundMat.melol;
    g.uTime!.value = t;
    g.uEdgeDark!.value = BOARD_ART.edgeDark;
    g.uSat!.value = BOARD_ART.saturation;
    g.uBright!.value = BOARD_ART.brightness;
    g.uCaustics!.value = BOARD_ART.caustics;
    const w = this.waterMat.melol;
    w.uTime!.value = t;
    w.uSat!.value = BOARD_ART.saturation;
    w.uBright!.value = BOARD_ART.brightness;
    w.uGloss!.value = BOARD_ART.waterGloss;
    w.uCaustics!.value = BOARD_ART.caustics;
    this.waterMat.envMapIntensity = BOARD_ART.waterGloss;
    this.tufts.melolTime.value = t;
    this.tufts.melolSway.value = BOARD_ART.sway;
  }
}
