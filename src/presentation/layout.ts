// 槽位（spec 5.8）：每个槽位是 3D 世界里的位置、朝向和缩放，所有动画以槽位为起止点。
// 坐标系：台面顶面是 y = 0 的平面，x 向右，z 朝向镜头（我方在 z 正方向），y 向上；单位是"台面单位"，
// 一张手牌宽 1.5。side 是相对 viewer 的：viewer 自己总在近处（near）。
import type { Side } from '../engine';

export type Vec3 = { x: number; y: number; z: number };
export type Slot = { pos: Vec3; rot: Vec3; scale: number };

// 分辨率基准 1920×1080（spec 5.4）：画布按 16:9 等比缩放，最窄 1280 宽。
export const ASPECT = 16 / 9;

// 固定透视镜头，从我方一侧斜着俯视棋盘。俯角 atan(18 / 11) ≈ 58.6°（spec 5.4：50° 到 60°）。
export const CAMERA = {
  fov: 38,
  pos: { x: 0, y: 18, z: 12.4 },
  target: { x: 0, y: 0, z: 1.4 },
};
// 镜头视线和水平面的夹角
export const CAMERA_PITCH = Math.atan2(CAMERA.pos.y - CAMERA.target.y, CAMERA.pos.z - CAMERA.target.z);

// 台面尺寸
export const TABLE = { width: 22, depth: 14.4, thickness: 0.7 };

// 卡牌原始尺寸（scale 为 1 时）。
export const CARD_W = 1.5;
export const CARD_H = 2.1;
export const CARD_T = 0.06;
// 随从底座
export const MINION_SIZE = 1.5;
export const MINION_HEIGHT = 0.32;

export type Placement = 'near' | 'far';

export function placementOf(side: Side, viewer: Side): Placement {
  return side === viewer ? 'near' : 'far';
}

const ROWS = {
  near: { board: 2.05, hero: 4.5, deck: 3.0, mana: 5.9 },
  far: { board: -2.05, hero: -4.95, deck: -3.0, mana: -6.4 },
} as const;

export const RIVER_Z = 0;
// 我方随从行的 z 半宽，落点判定用
export const BOARD_ROW_HALF = 1.3;
// 手牌区的边界：拖牌时指针投到台面上的 z 超过它就算还在手牌区
export const HAND_ZONE_Z = 5.6;
// 手牌往后仰的角度（相对正对镜头）
export const HAND_LEAN = 0.42;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const flat = { x: -Math.PI / 2, y: 0, z: 0 }; // 平放在台面上，正面朝上
// 立起来朝向镜头
const facing = (tilt = 0): Vec3 => ({ x: -CAMERA_PITCH + tilt, y: 0, z: 0 });

// 我方手牌：在台面近处边缘外侧，朝镜头立着，排成扇形；张数多时自动收紧。不悬停时下沉到画面底边，
// 只露出上面约七成（费用、原画、名字），不挡我方枢纽、英雄技能和法力条（tests/presentation-layout.test.ts 核对）。
// 对方手牌：在远处台面边缘，牌背朝上斜放。
export function handSlot(p: Placement, index: number, count: number): Slot {
  const offset = index - (count - 1) / 2;
  if (p === 'near') {
    const step = Math.min(1.3, count > 1 ? 8.6 / (count - 1) : 0);
    const sag = offset * offset * 0.045;
    return {
      pos: v(offset * step, 2.2 - sag + index * 0.004, 8.4 + Math.abs(offset) * 0.02),
      // 往后仰、随扇形微微转向，不平贴着正对镜头：看得到倾角和厚度边（spec 5.4 v0.6.2）
      rot: { x: -CAMERA_PITCH + HAND_LEAN, y: -offset * 0.06, z: -offset * 0.05 },
      scale: 1.3,
    };
  }
  const step = Math.min(0.75, count > 1 ? 6 / (count - 1) : 0);
  return {
    pos: v(offset * step, 0.25 + index * 0.012, -7.2 - offset * offset * 0.02),
    rot: { x: -Math.PI / 2 + 0.35, y: 0, z: Math.PI + offset * 0.05 },
    scale: 0.75,
  };
}

// 悬停的那张手牌：抬起、放大，倾角减半但不完全转正，保留立体感（spec 5.4 v0.6.2）。
export function handHoverSlot(index: number, count: number): Slot {
  const base = handSlot('near', index, count);
  return { pos: v(Math.max(-8, Math.min(8, base.pos.x)), 3.85, 7.2), rot: { x: -CAMERA_PITCH + HAND_LEAN / 2, y: base.rot.y * 0.4, z: 0 }, scale: 1.8 };
}

// 悬停时邻牌让开的偏移量（x 方向）。
export function handNeighborShift(index: number, hovered: number): number {
  if (index === hovered) return 0;
  const d = index - hovered;
  return Math.sign(d) * Math.max(0, 0.9 - (Math.abs(d) - 1) * 0.25);
}

// 换牌阶段的起手牌：在台面中央上方立起来，放大。
export function mulliganSlot(index: number, count: number): Slot {
  const o = index - (count - 1) / 2;
  return { pos: v(o * 2.6, 3.4, 2.6), rot: { x: -CAMERA_PITCH + 0.32, y: -o * 0.07, z: 0 }, scale: 1.45 };
}

// 场上第 index 个随从（共 count 个）。gapAt 不为 null 时在那个位置空出一格（拖随从牌时的空位）。
export function boardSlot(p: Placement, index: number, count: number, gapAt: number | null = null): Slot {
  const step = 1.95;
  const total = gapAt === null ? count : count + 1;
  const i = gapAt !== null && index >= gapAt ? index + 1 : index;
  return { pos: v((i - (total - 1) / 2) * step, 0, ROWS[p].board), rot: v(0, 0, 0), scale: 1 };
}

// 拖到我方随从行时，指针 x 对应的入场位置。
export function boardInsertIndex(x: number, count: number): number {
  for (let i = 0; i < count; i++) {
    if (x < boardSlot('near', i, count).pos.x) return i;
  }
  return count;
}

export function boardRowZ(p: Placement): number {
  return ROWS[p].board;
}

// 水晶枢纽内部的摆放（相对枢纽原点）：头像圆盘嵌在底座上、朝镜头倾斜，生命徽章嵌在底座右前角。
// HeroView 按这些值摆放，布局测试也用它们算生命数字在画面上的位置。
export const NEXUS = {
  // 圆盘像一枚硬币嵌在台座顶面，朝镜头微微仰起；中心抬到近侧边沿不会陷进台座顶板的高度
  discPos: v(0, 0.66, -0.05),
  discTilt: -Math.PI / 2 + 0.34,
  discRadius: 0.66,
  hpPos: v(0.74, 0.42, 0.6),
  hpScale: 1.45, // 生命徽章比随从的大一号
  hpRadius: 0.4,
};

export function heroSlot(p: Placement): Slot {
  return { pos: v(0, 0, ROWS[p].hero), rot: v(0, 0, 0), scale: 1 };
}

export function heroPowerSlot(p: Placement): Slot {
  return { pos: v(2.35, 0, ROWS[p].hero + (p === 'near' ? 0.2 : -0.2)), rot: v(0, 0, 0), scale: 1 };
}

export function deckSlot(p: Placement): Slot {
  return { pos: v(9.2, 0, ROWS[p].deck), rot: { ...flat, z: p === 'near' ? 0 : Math.PI }, scale: 1 };
}

// 法力条左端，10 颗水晶从左往右排，间距 MANA_STEP。
export function manaSlot(p: Placement): Slot {
  return { pos: v(4.4, 0, ROWS[p].mana), rot: v(0, 0, 0), scale: 1 };
}

export const MANA_STEP = 0.56;

export function endTurnSlot(): Slot {
  return { pos: v(9.0, 0, RIVER_Z), rot: v(0, 0, 0), scale: 1 };
}

// 对手出牌、自己出法术时展示的位置：台面中央上方，朝镜头。
export function showcaseSlot(): Slot {
  return { pos: v(0, 4.2, 3.2), rot: facing(0), scale: 1.7 };
}

// 悬停场上随从、英雄技能时，左侧放大显示的完整卡面（spec 5.3）：场景里的卡牌网格，正对镜头。
export function inspectSlot(): Slot {
  return { pos: v(-7.5, 4.6, 3.0), rot: facing(0), scale: 1.95 };
}

// 拖法术进入施法状态后牌停的位置（箭头从这里出发）。
export function castSlot(): Slot {
  return { pos: v(-5.2, 2.6, 6.0), rot: facing(0), scale: 0.9 };
}

// 爆牌时牌停的位置：手牌上方。
export function burnSlot(p: Placement): Slot {
  return { pos: v(4.2, 3.4, p === 'near' ? 5.0 : -3.5), rot: facing(0), scale: 1.2 };
}

// 横幅：镜头前方，台面中央上空。
export function bannerSlot(): Slot {
  return { pos: v(0, 5.5, 3.0), rot: facing(0), scale: 1 };
}

// 一个点在台面上的投影高度：飘字等效果从目标上方出发
export function above(p: Vec3, dy = 1): Vec3 {
  return { x: p.x, y: p.y + dy, z: p.z };
}
