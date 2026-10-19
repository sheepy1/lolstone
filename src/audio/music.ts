// 音乐和环境音（spec 5.7）。曲目是用户在试听页选定的（scripts/data/audio-sources.json 的 selected），
// 文件在 public/audio/music/<id>.ogg|mp3。
// 两层：音乐层同一时刻只放一首（菜单、对局、胜负收尾），换曲时停掉上一首；环境音单独一层，和对局音乐同时放。
// 语音播放时两层一起压低。
import { Howl } from 'howler';
import { channelVolume, onVolumeChange } from './channels';
import { musicSrc } from './files';

export type TrackId = 'menu' | 'match' | 'victory' | 'defeat' | 'ambience';

type Track = { loop: boolean; volume: number };

// volume 是相对音乐通道的轻重。素材已经统一过响度（音乐 -20、收尾 -18、环境音 -30 LUFS），
// 对局音乐再压低一点，不盖过音效（spec 5.7）。
export const TRACKS: Record<TrackId, Track> = {
  menu: { loop: true, volume: 1 },
  match: { loop: true, volume: 0.7 },
  victory: { loop: false, volume: 1 },
  defeat: { loop: false, volume: 1 },
  ambience: { loop: true, volume: 1 },
};

export const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

export function trackFiles(id: TrackId): string[] {
  return musicSrc(id);
}

const DUCK = 0.35;
let ducked = false;

type Layer = { id: TrackId | null; howl: Howl | null };
const music: Layer = { id: null, howl: null };
const ambience: Layer = { id: null, howl: null };

function apply(layer: Layer): void {
  if (!layer.howl || !layer.id) return;
  layer.howl.volume(TRACKS[layer.id].volume * channelVolume('music') * (ducked ? DUCK : 1));
}

onVolumeChange(() => {
  apply(music);
  apply(ambience);
});

function stop(layer: Layer): void {
  layer.howl?.stop();
  layer.howl?.unload();
  layer.howl = null;
  layer.id = null;
}

function start(layer: Layer, id: TrackId): void {
  // 同一首循环曲已经在放就不重来（比如回到主菜单时又调了一次 menu）
  if (layer.id === id && TRACKS[id].loop && layer.howl?.playing()) return;
  stop(layer);
  const t = TRACKS[id];
  // 循环曲解码成 Web Audio 缓冲区播放，循环点没有缝；HTML5 Audio 循环时会断一下
  layer.howl = new Howl({ src: trackFiles(id), loop: t.loop, html5: false });
  layer.id = id;
  apply(layer);
  layer.howl.play();
}

// 环境音进环境音层，其余进音乐层并停掉正在放的那首。
export function playMusic(id: TrackId): void {
  start(id === 'ambience' ? ambience : music, id);
}

// 停掉音乐和环境音。
export function stopMusic(): void {
  stop(music);
  stop(ambience);
}

export function stopAmbience(): void {
  stop(ambience);
}

// 语音播放时压低音乐和环境音。
export function duckMusic(on: boolean): void {
  ducked = on;
  apply(music);
  apply(ambience);
}
