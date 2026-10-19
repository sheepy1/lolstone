// 界面状态：React 文字界面和对局控制之间共享的一小块状态，用 useSyncExternalStore 订阅。
import { useSyncExternalStore } from 'react';
import type { HeroClass, Side } from '../engine';

export type Screen = 'boot' | 'menu' | 'loading' | 'match';

export type HoverCard = {
  cardId: string;
  // 场上随从的当前数值（和卡面不同时显示）
  stats?: { attack: number; health: number; maxHealth: number; keywords: string[]; frozen: boolean; silenced: boolean };
};

export type UiState = {
  screen: Screen;
  loading: { progress: number; label: string };
  menu: { humanClass: HeroClass; aiClass: HeroClass };
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
  menu: { humanClass: 'demacia', aiClass: 'freljord' },
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
