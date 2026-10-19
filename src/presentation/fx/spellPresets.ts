// 法术和英雄技能用的粒子变体（m4-storyboard E09、E10、E23）。分镜 1.5 的预设名字固定，这里只做它们的变体：
// 命中爆开、暗影爆发、溶解的光、冰霜贴地铺开，都由 1.5 的预设的层拼出来，参数约定（count、color、scale、to）不变。
// 单位和 particles/types.ts 一样：长度是世界单位，时间是秒。
import { FX_PALETTE, PRESETS } from './particles';
import type { Layer, PresetDef } from './particles';

const WHITE = 0xffffff;

const flash = (size: number, life: number, extra: Partial<Layer> = {}): Layer => ({
  name: 'flash',
  count: 1,
  fixed: true,
  life,
  shape: { kind: 'point' },
  offset: { x: 0, y: 0.35, z: 0 },
  dir: 'none',
  speed: 0,
  size,
  sizeCurve: [
    [0, 0.4],
    [0.2, 1],
    [1, 0.8],
  ],
  alphaCurve: [
    [0, 1],
    [1, 0],
  ],
  gradient: [
    [0, 'hot', 2.2],
    [1, 'main', 1.4],
  ],
  cell: 'glow',
  blend: 'add',
  align: 'billboard',
  ...extra,
});

const groundRing = (size: number, life: number, extra: Partial<Layer> = {}): Layer => ({
  name: 'ground_ring',
  count: 1,
  fixed: true,
  life,
  shape: { kind: 'point' },
  offset: { x: 0, y: 0.03, z: 0 },
  dir: 'none',
  speed: 0,
  size,
  sizeCurve: [
    [0, 0.15],
    [1, 1],
  ],
  alphaCurve: [
    [0, 1],
    [1, 0],
  ],
  gradient: [
    [0, 'hot', 1.8],
    [1, 'main', 1],
  ],
  cell: 'ring',
  blend: 'add',
  align: 'ground',
  ...extra,
});

const layerOf = (def: PresetDef, name: string): Layer => {
  const l = def.layers.find((x) => x.name === name);
  if (!l) throw new Error(`no layer ${name}`);
  return l;
};

// 火球命中爆开：一团向外翻滚的火焰、往上溅的火星、一缕黑烟和贴地的焦痕环。fire_bolt 的火焰层改成向外迸发
const boltFlames = layerOf(PRESETS.fire_bolt, 'flames');
export const fire_burst: PresetDef = {
  count: 30,
  dir: 'out',
  color: FX_PALETTE.fire,
  layers: [
    flash(2.2, 0.13, { gradient: [[0, 'hot', 1.8], [0.4, 'main', 1.6], [1, 'deep', 0.8]] }),
    {
      ...boltFlames,
      count: 34,
      duration: 0.04,
      life: [0.25, 0.42],
      shape: { kind: 'sphere', radius: 0.2 },
      offset: { x: 0, y: 0.35, z: 0 },
      dir: 'out',
      followDir: true,
      lift: 0.5,
      spread: 0.8,
      speed: [2.6, 4.8],
      drag: 5,
      inherit: 0,
      gravity: 1.2,
      size: [0.55, 0.9],
    },
    {
      ...layerOf(PRESETS.fire_bolt, 'sparks'),
      count: 18,
      duration: 0,
      life: [0.3, 0.55],
      offset: { x: 0, y: 0.35, z: 0 },
      dir: 'out',
      followDir: true,
      lift: 0.8,
      spread: 1,
      speed: [3, 6],
      gravity: -9,
      drag: 1,
    },
    {
      ...layerOf(PRESETS.fire_bolt, 'smoke'),
      count: 6,
      duration: 0.05,
      delay: 0.06,
      life: [0.5, 0.8],
      offset: { x: 0, y: 0.5, z: 0 },
      shape: { kind: 'sphere', radius: 0.3 },
    },
    groundRing(2.6, 0.32, { gradient: [[0, 'hot', 1.6], [1, 'deep', 0.6]] }),
  ],
};

// 暗影爆发：聚拢收缩之后向外炸开的紫光条和翻滚的紫黑烟
export const shadow_burst: PresetDef = {
  count: 16,
  dir: 'out',
  color: FX_PALETTE.shadow,
  layers: [
    flash(2.0, 0.14, { gradient: [[0, FX_PALETTE.debuff, 2.6], [0.5, 'main', 2], [1, 'deep', 1]] }),
    {
      name: 'streaks',
      count: 24,
      followDir: true,
      duration: 0,
      life: [0.24, 0.4],
      shape: { kind: 'sphere', radius: 0.15 },
      offset: { x: 0, y: 0.35, z: 0 },
      dir: 'out',
      lift: 0.3,
      speed: [6, 9],
      drag: 3,
      size: 0.12,
      stretch: 0.08,
      alphaCurve: [
        [0, 1],
        [1, 0],
      ],
      gradient: [
        [0, WHITE, 2.4],
        [0.3, FX_PALETTE.debuff, 2.4],
        [1, 'main', 1.4],
      ],
      cell: 'ember',
      blend: 'add',
      bloom: true,
      align: 'velocity',
    },
    {
      ...layerOf(PRESETS.shadow_gather, 'wisps'),
      count: 10,
      duration: 0.04,
      life: [0.35, 0.55],
      shape: { kind: 'sphere', radius: 0.25 },
      dir: 'out',
      followDir: true,
      lift: 0.3,
      speed: [1.6, 2.6],
      drag: 3,
      size: [0.5, 0.8],
      sizeCurve: [
        [0, 0.5],
        [1, 1.4],
      ],
      alphaCurve: [
        [0, 0.8],
        [1, 0],
      ],
    },
    groundRing(2.4, 0.3, { gradient: [[0, FX_PALETTE.debuff, 1.6], [1, 'main', 0.8]] }),
  ],
};

// 卡牌溶解成光：从卡面四散的光点（卡在中央，正对镜头，box 是卡面的大小）
export const card_dissolve: PresetDef = {
  count: 36,
  dir: 'out',
  color: FX_PALETTE.light,
  layers: [
    {
      name: 'motes',
      count: 36,
      followDir: true,
      duration: 0.08,
      life: [0.18, 0.32],
      shape: { kind: 'box', size: [2.4, 3.4, 0.1] },
      dir: 'out',
      speed: [1.2, 3],
      drag: 3,
      size: [0.08, 0.14],
      alphaCurve: [
        [0, 1],
        [1, 0],
      ],
      gradient: [
        [0, WHITE, 2.6],
        [0.4, 'main', 2.2],
        [1, 'main', 1.2],
      ],
      cell: 'ember',
      blend: 'add',
      bloom: true,
      align: 'billboard',
    },
    flash(3.4, 0.14, { offset: { x: 0, y: 0, z: 0 } }),
  ],
};

// 溶解后飞向目标的一道光（冰、光、影、物理的单体法术）：只要亮核和火星，没有火焰和烟
export const light_streak: PresetDef = {
  ...PRESETS.fire_bolt,
  count: 14,
  travel: 0.1,
  arc: 0.4,
  layers: [
    { ...layerOf(PRESETS.fire_bolt, 'head'), size: [0.7, 0.9], gradient: [[0, WHITE, 2.6], [0.5, 'main', 2.2], [1, 'main', 1.4]] },
    { ...layerOf(PRESETS.fire_bolt, 'flames'), count: 16, life: [0.12, 0.2], gravity: 0, size: [0.3, 0.45], gradient: [[0, 'hot', 2], [1, 'main', 1]] },
    { ...layerOf(PRESETS.fire_bolt, 'sparks'), count: 14, gravity: 0, life: [0.12, 0.22] },
  ],
};

// 冰霜贴地铺开：寒雾和冰晶沿台面向外推，一圈霜环。frost_spread 的冰晶是往上冒的（E17 冻结在用），这里改成向外
const frostCrystals = layerOf(PRESETS.frost_spread, 'crystals');
export const frost_creep: PresetDef = {
  count: 18,
  dir: 'out',
  color: FX_PALETTE.ice,
  layers: [
    {
      ...frostCrystals,
      count: 26,
      duration: 0.24,
      shape: { kind: 'disc', radius: 0.3, height: [0.05, 0.2] },
      dir: 'out',
      lift: 0.45,
      speed: [1.8, 3.4],
      drag: 3,
      size: [0.18, 0.3],
      gradient: [[0, WHITE, 2.6], [0.3, 'main', 2.4], [1, 'deep', 1.4]],
    },
    {
      ...layerOf(PRESETS.frost_spread, 'mist'),
      count: 14,
      duration: 0.22,
      shape: { kind: 'disc', radius: 0.4, edge: true, height: [0.2, 0.35] },
      size: [0.8, 1.1],
      gradient: [[0, 'main', 0.9], [1, 'deep', 0.5]],
    },
    { ...layerOf(PRESETS.frost_spread, 'glints'), count: 8 },
    groundRing(3.2, 0.34, { gradient: [[0, WHITE, 1.8], [1, 'main', 1]] }),
    groundRing(2, 0.3, { delay: 0.1, gradient: [[0, 'hot', 1.5], [1, 'main', 0.8]] }),
  ],
};

// 冰霜命中的一下：碎冰溅开加一个冷白闪（冰箭命中、冰霜扩散铺满的那一帧）
export const frost_hit: PresetDef = {
  count: 10,
  dir: 'out',
  color: FX_PALETTE.ice,
  layers: [flash(1.5, 0.12, { gradient: [[0, WHITE, 2.2], [1, 'main', 1.4]] }), { ...layerOf(PRESETS.ice_shatter, 'shards'), count: 8, size: [0.12, 0.2] }, { ...layerOf(PRESETS.ice_shatter, 'glints'), count: 6 }],
};

export const SPELL_PRESETS = { fire_burst, shadow_burst, card_dissolve, light_streak, frost_creep, frost_hit };
