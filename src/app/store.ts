// 界面状态：React 文字界面和对局控制之间共享的一小块状态，用 useSyncExternalStore 订阅。
import { useSyncExternalStore } from 'react';
import type { HeroClass, Side } from '../engine';
import type { EndReason } from '../logic/state';
import type { Difficulty } from '../ui/menuData';

// waiting 是联机的等待页（显示邀请码，等对手进来）
export type Screen = 'boot' | 'menu' | 'waiting' | 'loading' | 'match' | 'decks';

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

// 联机的界面状态（docs/online.md 3.4）。UiState.online 为 null 时没有联机入口，主菜单和单机一样
export type OnlineUi = {
  nickname: string;
  open: boolean; // 主菜单的联机面板开着
  busy: boolean; // 正在建房、进房、续局，按钮先禁用
  notice: string | null; // 联机面板里的提示（邀请码不对、卡组不合规）
  // 没打完的局：主菜单打开时提示续上还是离开。started 为 false 时还在等人，code 是它的邀请码
  pending: { started: boolean; code: string | null } | null;
  // 等待页：code 为 null 时还在连接平台；joined 是对手已经进来、正在开局
  room: { code: string | null; joined: boolean } | null;
  match: OnlineMatchUi | null; // 联机对局中（加载页、对局、结算面板）
};

export type OnlineMatchUi = {
  myClass: HeroClass;
  opponent: string; // 对手的昵称
  opponentClass: HeroClass;
  phase: 'mulligan' | 'playing' | 'over';
  deadline: number | null; // 当前计时的到期时刻（本地时钟）
  opponentOffline: boolean; // 对手断线、还没被判负：顶部横幅显示中
  graceUntil: number | null; // 对手断线判负的到期时刻（本地时钟）；对手在线、或者平台的广播没带宽限时为 null
};

export type UiState = {
  screen: Screen;
  loading: { progress: number; label: string };
  // humanDeck：我方用的自组卡组 id，null 时用预组
  menu: { humanClass: HeroClass; aiClass: HeroClass; difficulty: Difficulty; humanDeck: string | null };
  // 换牌页：显示局面在换牌阶段、轮到玩家提交时打开
  mulligan: { open: boolean; marked: number };
  // reason 是结束原因：联机的结算面板显示它（对手认输、对手超时、对手离开），单机不显示
  result: { winner: Side | 'draw'; won: boolean; turns: number; reason: EndReason } | null;
  hover: HoverCard | null;
  log: string[];
  logOpen: boolean;
  status: { busy: boolean; myTurn: boolean; speed: number; replay: boolean };
  panels: Panel[];
  error: string | null;
  online: OnlineUi | null;
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
  online: null,
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
