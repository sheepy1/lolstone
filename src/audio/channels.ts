// 四条音量通道（spec 5.7）：主音量、音乐、音效、语音。设置存在 localStorage，设置页（M5）改这里。
import { Howler } from 'howler';
import { VOLUME_DEFAULTS as DEFAULTS, type Channel, type Volumes } from './defaults';

export type { Channel, Volumes } from './defaults';

const STORAGE_KEY = 'melol.volumes';

let volumes: Volumes = load();

// 地址带 ?mute=1 时静音，其余情况默认有声（开发环境也一样）。
// 自动化试玩（其他会话在内置浏览器里跑）必须带 ?mute=1，否则声音会从用户的电脑里放出来。
function startMuted(): boolean {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  return params.has('mute');
}

export const MUTED_AT_START = startMuted();
// Howler 在模块加载时就静音，早于任何一次播放
Howler.mute(MUTED_AT_START);
const listeners = new Set<(v: Volumes) => void>();

function load(): Volumes {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Volumes>) };
  } catch {
    // 隐私模式等情况下 localStorage 不可用，用默认值
  }
  return { ...DEFAULTS };
}

export function getVolumes(): Volumes {
  return volumes;
}

export function setVolume(channel: Channel, value: number): void {
  volumes = { ...volumes, [channel]: Math.min(1, Math.max(0, value)) };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    // 存不下就只在本次生效
  }
  if (channel === 'master') Howler.volume(volumes.master);
  for (const fn of listeners) fn(volumes);
}

// 某条通道的实际音量（主音量由 Howler 全局乘，这里只算通道自己的）。
export function channelVolume(channel: Exclude<Channel, 'master'>): number {
  return volumes[channel];
}

export function onVolumeChange(fn: (v: Volumes) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 浏览器要求用户手势之后才能出声（spec 5.7），第一次点击时调用。
let unlocked = false;
export function initAudio(): void {
  if (unlocked) return;
  unlocked = true;
  Howler.volume(volumes.master);
  const ctx = Howler.ctx as AudioContext | undefined;
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}
