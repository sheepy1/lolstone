// 设置（spec 5.1 设置页）：动画速度和 AI 难度的默认值，存在 localStorage。四条音量由 src/audio 自己存（melol.volumes），
// 这里只在"恢复默认"时把它们设回默认值。localStorage 读写都包在 try/catch 里：隐私模式、存储被禁用时只在本次生效。
import { VOLUME_DEFAULTS, type Channel } from '../audio/defaults';
import type { Difficulty } from './menuData';

// 音量的类型和默认值来自 src/audio/defaults.ts（不依赖 DOM，Node 侧测试也能引）
export { VOLUME_DEFAULTS };

export type AnimSpeed = 1 | 1.5 | 2;

export type Settings = {
  animSpeed: AnimSpeed; // 导演的全局速度倍数；点击或空格快进仍然是三倍速
  difficulty: Difficulty; // 主菜单 AI 难度的默认值，和主菜单的选择同步
};

export const SETTINGS_KEY = 'melol.settings';
export const SETTINGS_DEFAULTS: Settings = { animSpeed: 1, difficulty: 'l1' };

export const ANIM_SPEEDS: { id: AnimSpeed; name: string }[] = [
  { id: 1, name: '正常' },
  { id: 1.5, name: '快' },
  { id: 2, name: '很快' },
];

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// 只认识合法的值，其余按默认值，存储里的旧数据或手改坏的数据不会让页面出错。
export function parseSettings(raw: string | null | undefined): Settings {
  let data: Partial<Record<keyof Settings, unknown>> = {};
  try {
    if (raw) data = JSON.parse(raw) as typeof data;
  } catch {
    data = {};
  }
  const animSpeed = ANIM_SPEEDS.some((s) => s.id === data.animSpeed) ? (data.animSpeed as AnimSpeed) : SETTINGS_DEFAULTS.animSpeed;
  const difficulty = data.difficulty === 'l0' || data.difficulty === 'l1' ? data.difficulty : SETTINGS_DEFAULTS.difficulty;
  return { animSpeed, difficulty };
}

function load(): Settings {
  try {
    return parseSettings(storage()?.getItem(SETTINGS_KEY));
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>): void {
  const next = { ...current, ...patch };
  if (next.animSpeed === current.animSpeed && next.difficulty === current.difficulty) return;
  current = next;
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // 存不下就只在本次生效
  }
  for (const fn of listeners) fn(current);
}

export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 测试用：重新从存储读一遍
export function reloadSettings(): Settings {
  current = load();
  return current;
}

// 设置页试放的记录（开发环境默认静音，自动化验证时靠它核对试放调用）
export const auditionLog: { channel: Extract<Channel, 'sfx' | 'voice'>; at: number }[] = [];
