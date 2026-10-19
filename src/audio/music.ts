// 音乐和环境音（spec 5.7）。M3 没有曲子，只有接口：曲目放进 public/audio/music/ 后在 TRACKS 里登记。
import { Howl } from 'howler';
import { channelVolume, onVolumeChange } from './channels';

export type TrackId = 'menu' | 'match' | 'victory' | 'defeat' | 'ambience';

const TRACKS: Partial<Record<TrackId, { src: string; loop: boolean; volume: number }>> = {};

const DUCK = 0.35;
let music: Howl | null = null;
let musicBase = 1;
let ducked = false;

function apply(): void {
  music?.volume(musicBase * channelVolume('music') * (ducked ? DUCK : 1));
}

onVolumeChange(apply);

export function playMusic(id: TrackId): void {
  const t = TRACKS[id];
  music?.stop();
  music = null;
  if (!t) return;
  musicBase = t.volume;
  music = new Howl({ src: [t.src], loop: t.loop, html5: true });
  apply();
  music.play();
}

export function stopMusic(): void {
  music?.stop();
  music = null;
}

// 语音播放时压低音乐。
export function duckMusic(on: boolean): void {
  ducked = on;
  apply();
}
