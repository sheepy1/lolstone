// 棋盘地形的高度场（spec 5.2）：程序生成，不需要外部素材。纯函数，不依赖 DOM，测试直接调用。
// - 河道：沿中线略微蜿蜒，挖下去，河床最深 RIVER_DEPTH；
// - 左侧是野区：起伏的丘陵，离台面边缘越近越低，接上台面边框；
// - 其余地面只有很小的起伏；随从行、枢纽、英雄技能、牌库、法力条、结束回合按钮脚下是平的，物件不会悬空或陷进去。
import { boardSlot, deckSlot, endTurnSlot, heroPowerSlot, heroSlot, MANA_STEP, manaSlot, TABLE, type Placement } from '../presentation/layout';

export const RIVER_DEPTH = 0.42;
export const WATER_LEVEL = -0.17;

function hash(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 平滑的值噪声，输出 0 到 1
export function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbm(x: number, z: number): number {
  return valueNoise(x, z) * 0.6 + valueNoise(x * 2.1 + 7, z * 2.1 + 3) * 0.3 + valueNoise(x * 4.3 + 11, z * 4.3 + 5) * 0.1;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// 河道中心线的 z
export function riverCenter(x: number): number {
  return 0.3 * Math.sin(x * 0.32 + 0.6);
}

type Pad = { x: number; z: number; r: number };

// 物件脚下要平的圆形区域
function pads(): Pad[] {
  const out: Pad[] = [];
  for (const p of ['near', 'far'] as Placement[]) {
    const h = heroSlot(p).pos;
    out.push({ x: h.x, z: h.z, r: 1.9 });
    const hp = heroPowerSlot(p).pos;
    out.push({ x: hp.x, z: hp.z, r: 0.95 });
    const d = deckSlot(p).pos;
    out.push({ x: d.x, z: d.z, r: 1.5 });
    const m = manaSlot(p).pos;
    for (let i = -2; i < 11; i++) out.push({ x: m.x + i * MANA_STEP, z: m.z, r: 0.6 });
  }
  const e = endTurnSlot().pos;
  out.push({ x: e.x, z: e.z, r: 1.6 });
  return out;
}

const PADS = pads();
const ROW_Z = { near: boardSlot('near', 0, 1).pos.z, far: boardSlot('far', 0, 1).pos.z };

// 0 表示必须平，1 表示可以起伏
export function freedom(x: number, z: number): number {
  let f = 1;
  // 随从行：整行加上左右余量
  for (const rz of [ROW_Z.near, ROW_Z.far]) {
    if (Math.abs(x) < 7.8) f = Math.min(f, smooth(1.0, 1.5, Math.abs(z - rz)));
  }
  for (const p of PADS) f = Math.min(f, smooth(p.r, p.r + 0.5, Math.hypot(x - p.x, z - p.z)));
  return f;
}

// 台面上 (x, z) 处的地面高度
export function terrainHeight(x: number, z: number): number {
  const W = TABLE.width / 2;
  const D = TABLE.depth / 2;
  const free = freedom(x, z);
  // 河道：距中心线 0.55 以内是河床，1.15 以外是平地
  const d = Math.abs(z - riverCenter(x));
  let h = -RIVER_DEPTH * (1 - smooth(0.55, 1.15, d));
  // 左侧野区的丘陵，贴近台面边缘时降回 0，接上边框
  const jungle = smooth(-8.2, -9.2, x) * smooth(W, W - 0.6, Math.abs(x)) * smooth(D, D - 0.5, Math.abs(z));
  const hills = (0.25 + 0.75 * fbm(x * 0.55 + 3, z * 0.55)) * 0.9;
  h += jungle * hills * (1 - smooth(0.9, 0.3, d)); // 河道穿过野区时仍然是低的
  // 远近两条边上零星的小土包
  const rim = smooth(D - 1.2, D - 0.6, Math.abs(z)) * smooth(D, D - 0.3, Math.abs(z)) * smooth(W, W - 0.5, Math.abs(x));
  h += rim * 0.25 * fbm(x * 0.9, z * 0.9 + 9);
  // 全场的细小起伏
  h += (fbm(x * 1.7 + 20, z * 1.7 + 20) - 0.5) * 0.06;
  return h * free;
}
