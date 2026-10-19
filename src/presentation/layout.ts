// 槽位坐标（spec 5.8）。所有动画以这里给出的槽位为起止点。坐标系是 1920×1080 的逻辑分辨率（spec 5.4），
// 画布等比缩放到窗口。上半边是对手，下半边是我方；side 是相对 viewer 的：viewer 自己总在下方。
import type { Side } from '../engine';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export type Slot = { x: number; y: number; rotation: number; scale: number };

const CX = STAGE_W / 2;

// 卡牌原始尺寸（scale 为 1 时）。
export const CARD_W = 150;
export const CARD_H = 210;
// 场上随从头像尺寸。
export const MINION_SIZE = 104;

export type Placement = 'near' | 'far'; // near：我方（下方），far：对手（上方）

export function placementOf(side: Side, viewer: Side): Placement {
  return side === viewer ? 'near' : 'far';
}

const ROWS = {
  near: { hand: 985, board: 668, hero: 872, deck: 760, mana: 1050 },
  far: { hand: 40, board: 408, hero: 196, deck: 300, mana: 32 },
} as const;

export const RIVER_Y = 538;
export const HAND_TOP_Y = 880; // 我方手牌区的上沿，拖出这条线算离开手牌区
export const BOARD_ROW_HALF = 96; // 随从行的半高，落点判定用

// 手牌扇形。count 张里的第 index 张。张数多时自动收紧。
export function handSlot(p: Placement, index: number, count: number): Slot {
  const scale = p === 'near' ? 0.95 : 0.62;
  const maxSpan = p === 'near' ? 820 : 560;
  const step = Math.min(p === 'near' ? 118 : 74, count > 1 ? maxSpan / (count - 1) : 0);
  const offset = index - (count - 1) / 2;
  const angle = offset * (p === 'near' ? 3.2 : 3.6) * (Math.PI / 180);
  const sag = Math.abs(offset) * Math.abs(offset) * (p === 'near' ? 3 : 2);
  return {
    x: CX + offset * step,
    y: p === 'near' ? ROWS.near.hand + sag : ROWS.far.hand - sag,
    rotation: p === 'near' ? angle : -angle,
    scale,
  };
}

// 悬停的那张手牌：上浮放大到清晰可读。
export function handHoverSlot(index: number, count: number): Slot {
  const base = handSlot('near', index, count);
  return { x: Math.min(Math.max(base.x, 160), STAGE_W - 160), y: 836, rotation: 0, scale: 1.55 };
}

// 悬停时邻牌让开的偏移量。
export function handNeighborShift(index: number, hovered: number): number {
  if (index === hovered) return 0;
  const d = index - hovered;
  return Math.sign(d) * Math.max(0, 70 - (Math.abs(d) - 1) * 20);
}

// 换牌阶段的起手牌，横排在中央放大。
export function mulliganSlot(index: number, count: number): Slot {
  const step = 250;
  return { x: CX + (index - (count - 1) / 2) * step, y: 500, rotation: 0, scale: 1.45 };
}

// 场上第 index 个随从（共 count 个）。gapAt 不为 null 时在那个位置空出一格（拖随从牌时的空位阴影）。
export function boardSlot(p: Placement, index: number, count: number, gapAt: number | null = null): Slot {
  const step = 140;
  const total = gapAt === null ? count : count + 1;
  const i = gapAt !== null && index >= gapAt ? index + 1 : index;
  return { x: CX + (i - (total - 1) / 2) * step, y: ROWS[p].board, rotation: 0, scale: 1 };
}

// 拖到我方随从行时，鼠标 x 对应的入场位置。
export function boardInsertIndex(x: number, count: number): number {
  for (let i = 0; i < count; i++) {
    if (x < boardSlot('near', i, count).x) return i;
  }
  return count;
}

export function boardRowY(p: Placement): number {
  return ROWS[p].board;
}

export function heroSlot(p: Placement): Slot {
  return { x: CX, y: ROWS[p].hero, rotation: 0, scale: 1 };
}

export function heroPowerSlot(p: Placement): Slot {
  return { x: CX + 170, y: ROWS[p].hero + (p === 'near' ? 14 : -14), rotation: 0, scale: 1 };
}

export function deckSlot(p: Placement): Slot {
  return { x: 1810, y: ROWS[p].deck, rotation: 0, scale: 0.62 };
}

// 法力条左端。10 格从左往右排。
export function manaSlot(p: Placement): Slot {
  return { x: 1500, y: ROWS[p].mana, rotation: 0, scale: 1 };
}

export const MANA_CELL = 38;

export function endTurnSlot(): Slot {
  return { x: 1690, y: RIVER_Y, rotation: 0, scale: 1 };
}

// 对手出牌时展示的位置，和自己出法术时的展示位置。
export function showcaseSlot(): Slot {
  return { x: CX, y: RIVER_Y - 10, rotation: 0, scale: 1.7 };
}

// 拖法术进入施法状态后牌停的位置（箭头从这里出发）。
export function castSlot(): Slot {
  return { x: CX - 330, y: 860, rotation: 0, scale: 0.8 };
}

// 爆牌时牌停的位置：手牌上方。
export function burnSlot(p: Placement): Slot {
  return { x: CX + 360, y: p === 'near' ? 760 : 300, rotation: 0, scale: 1.2 };
}

export function bannerSlot(): Slot {
  return { x: CX, y: RIVER_Y, rotation: 0, scale: 1 };
}
