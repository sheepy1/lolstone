// 音频（spec 5.7）：通道、音效表、语音、音乐。
import { initAudio as unlockAudio } from './channels';
import { preloadSfx } from './sfx';

export { getVolumes, setVolume, onVolumeChange, type Channel, type Volumes } from './channels';
export { playSfx, sfxLog, sfxFiles, SFX_TABLE, SFX_IDS, type SfxId, type SfxOptions } from './sfx';
export { playVoice, preloadVoice } from './voice';
export { playMusic, stopMusic, stopAmbience, duckMusic, trackFiles, TRACKS, TRACK_IDS, type TrackId } from './music';

// 浏览器要求用户手势之后才能出声（spec 5.7），第一次点击时调用：解锁音频，同时预载全部音效。
let preloaded = false;
export function initAudio(): void {
  unlockAudio();
  if (preloaded) return;
  preloaded = true;
  preloadSfx();
}
