// 音频（spec 5.7）：通道、音效表、语音、音乐。
export { initAudio, getVolumes, setVolume, onVolumeChange, type Channel, type Volumes } from './channels';
export { playSfx, sfxLog, SFX_TABLE, type SfxId } from './sfx';
export { playVoice, preloadVoice } from './voice';
export { playMusic, stopMusic, duckMusic, type TrackId } from './music';
