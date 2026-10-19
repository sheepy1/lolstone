// 界面状态：React 文字界面和对局控制之间共享的一小块状态，用 useSyncExternalStore 订阅。
import { useSyncExternalStore } from 'react';
import type { HeroClass, Side } from '../engine';
import type { Difficulty } from '../ui/menuData';

export type Screen = 'boot' | 'menu' | 'loading' | 'match';

export type HoverCard = {
  cardId: string;
  // 场上随从的当前数值（和卡面不同时显示）
  stats?: { attack: number; health: number; maxHealth: number; keywords: string[]; frozen: boolean; silenced: boolean };
  // 场景里放大卡左下角的页面坐标；关键词解释贴在它下面。null 时贴在画面左侧
  anchor?: { left: number; top: number; width: number } | null;
  // 指针停在场上随从的哪个关键词图标上（KEYWORD_HELP 的词条名），面板里这一条排最前、高亮
  keyword?: string | null;
};

export type UiState = {
  screen: Screen;
  loading: { progress: number; label: string };
  menu: { humanClass: HeroClass; aiClass: HeroClass; difficulty: Difficulty };
  // 换牌页：显示局面在换牌阶段、轮到玩家提交时打开
  mulligan: { open: boolean; marked: number };
  result: { winner: Side | 'draw'; won: boolean; turns: number } | null;
  hover: HoverCard | null;
  log: string[];
  logOpen: boolean;
  status: { busy: boolean; myTurn: boolean; speed: number; renderer: string; replay: boolean };
  error: string | null;
};

let state: UiState = {
  screen: 'boot',
  loading: { progress: 0, label: '' },
  menu: { humanClass: 'demacia', aiClass: 'freljord', difficulty: 'l1' },
  mulligan: { open: false, marked: 0 },
  result: null,
  hover: null,
  log: [],
  logOpen: false,
  status: { busy: false, myTurn: false, speed: 1, renderer: '', replay: false },
  error: null,
};

const listeners = new Set<() => void>();

export function getUi(): UiState {
  return state;
}

export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const fn of listeners) fn();
}

export function subscribeUi(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(subscribeUi, () => select(state));
}
