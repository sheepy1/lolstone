// 界面状态：React 文字界面和对局控制之间共享的一小块状态，用 useSyncExternalStore 订阅。
import { useSyncExternalStore } from 'react';
import type { HeroClass, Side } from '../engine';
import type { Difficulty } from '../ui/menuData';

export type Screen = 'boot' | 'menu' | 'loading' | 'match' | 'decks';

// 叠在页面上的面板，后打开的在上面：对局菜单（pause）里可以再打开设置。对局中有任何面板打开时游戏暂停。
export type Panel = 'pause' | 'settings';

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
  // humanDeck：我方用的自组卡组 id，null 时用预组
  menu: { humanClass: HeroClass; aiClass: HeroClass; difficulty: Difficulty; humanDeck: string | null };
  // 换牌页：显示局面在换牌阶段、轮到玩家提交时打开
  mulligan: { open: boolean; marked: number };
  result: { winner: Side | 'draw'; won: boolean; turns: number } | null;
  hover: HoverCard | null;
  log: string[];
  logOpen: boolean;
  status: { busy: boolean; myTurn: boolean; speed: number; replay: boolean };
  panels: Panel[];
  error: string | null;
};

let state: UiState = {
  screen: 'boot',
  loading: { progress: 0, label: '' },
  menu: { humanClass: 'demacia', aiClass: 'freljord', difficulty: 'l1', humanDeck: null },
  mulligan: { open: false, marked: 0 },
  result: null,
  hover: null,
  log: [],
  logOpen: false,
  status: { busy: false, myTurn: false, speed: 1, replay: false },
  panels: [],
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

// 打开一个面板，放到最上面（已经开着就挪到最上面）
export function pushPanel(panel: Panel): void {
  setUi((s) => ({ panels: [...s.panels.filter((p) => p !== panel), panel] }));
}

// 关掉最上面的面板；all 为 true 时全部关掉
export function popPanel(all = false): void {
  setUi((s) => ({ panels: all ? [] : s.panels.slice(0, -1) }));
}

export function subscribeUi(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(subscribeUi, () => select(state));
}
