// 音乐和环境音（spec 5.7）。曲目是用户在试听页选定的（scripts/data/audio-sources.json 的 selected），
// 文件在 public/audio/music/<id>.ogg|mp3。
// 两层：音乐层同一时刻只放一首（菜单、对局、胜负收尾），换曲时停掉上一首；环境音单独一层，和菜单、对局音乐同时放。
// 语音播放时两层一起压低。
import { Howl } from 'howler';
import { channelVolume, onVolumeChange } from './channels';
import { musicSrc } from './files';

export type TrackId = 'menu' | 'match' | 'victory' | 'defeat' | 'ambience';

/**
 * volume：相对音乐通道的轻重。素材已经统一过响度（音乐 -20、收尾 -18、环境音 -30 LUFS），对局音乐再压低一点，
 * 不盖过音效（spec 5.7）。
 * fadeIn：起播时从 0 淡入的毫秒数。主菜单音乐和环境音淡入（m4-first-minutes 第 2 步、m4-storyboard E01）；
 * 对局音乐在 E01 的 t=0 直接起，胜负收尾要第一拍就有力，都不淡入。
 * ambience：放这首时把环境音层也带起来（主菜单和对局都有峡谷环境音，m4-first-minutes 第 2 步）。
 */
type Track = { loop: boolean; volume: number; fadeIn: number; ambience?: boolean };

export const TRACKS: Record<TrackId, Track> = {
  menu: { loop: true, volume: 1, fadeIn: 1500, ambience: true },
  match: { loop: true, volume: 0.7, fadeIn: 0, ambience: true },
  victory: { loop: false, volume: 1, fadeIn: 0 },
  defeat: { loop: false, volume: 1, fadeIn: 0 },
  ambience: { loop: true, volume: 1, fadeIn: 2500 },
};

export const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

export function trackFiles(id: TrackId): string[] {
  return musicSrc(id);
}

/** 语音播放时音乐和环境音压低 6 dB（m4-storyboard 1.6），压低和恢复各用 DUCK_MS 渐变，不突兀。 */
export const DUCK = 10 ** (-6 / 20);
const DUCK_MS = 150;
/** 停环境音时淡出的毫秒数，回主菜单时不至于一下断掉。 */
const STOP_FADE_MS = 400;
let ducked = false;

type Layer = { id: TrackId | null; howl: Howl | null; sound: number | null };
const music: Layer = { id: null, howl: null, sound: null };
const ambience: Layer = { id: null, howl: null, sound: null };

function target(layer: Layer): number {
  return layer.id ? TRACKS[layer.id].volume * channelVolume('music') * (ducked ? DUCK : 1) : 0;
}

function apply(layer: Layer, fadeMs = 0): void {
  const h = layer.howl;
  if (!h || layer.sound === null) return;
  if (fadeMs > 0 && h.playing(layer.sound)) h.fade(h.volume(layer.sound) as number, target(layer), fadeMs, layer.sound);
  else h.volume(target(layer), layer.sound);
}

onVolumeChange(() => {
  apply(music);
  apply(ambience);
});

function stop(layer: Layer, fadeMs = 0): void {
  const h = layer.howl;
  const sound = layer.sound;
  layer.howl = null;
  layer.id = null;
  layer.sound = null;
  if (!h) return;
  if (fadeMs > 0 && sound !== null && h.playing(sound)) {
    h.fade(h.volume(sound) as number, 0, fadeMs, sound);
    h.once('fade', () => h.unload(), sound);
  } else {
    h.stop();
    h.unload();
  }
}

function start(layer: Layer, id: TrackId): void {
  const t = TRACKS[id];
  // 同一首循环曲已经在放就不重来（比如回到主菜单时又调了一次 menu）
  if (layer.id === id && t.loop && layer.howl?.playing()) return;
  stop(layer);
  // 循环曲解码成 Web Audio 缓冲区播放，循环点没有缝；HTML5 Audio 循环时会断一下
  const h = new Howl({ src: trackFiles(id), loop: t.loop, html5: false, volume: t.fadeIn > 0 ? 0 : 1 });
  layer.howl = h;
  layer.id = id;
  layer.sound = h.play();
  if (t.fadeIn > 0) h.fade(0, target(layer), t.fadeIn, layer.sound);
  else apply(layer);
}

// 环境音进环境音层，其余进音乐层并停掉正在放的那首；菜单和对局音乐顺带把环境音层带起来（已经在放就不动）。
export function playMusic(id: TrackId): void {
  if (id === 'ambience') {
    start(ambience, id);
    return;
  }
  start(music, id);
  if (TRACKS[id].ambience) start(ambience, 'ambience');
}

// 停掉音乐和环境音。
export function stopMusic(): void {
  stop(music);
  stop(ambience);
}

export function stopAmbience(): void {
  stop(ambience, STOP_FADE_MS);
}

// 语音播放时压低音乐和环境音。
export function duckMusic(on: boolean): void {
  if (ducked === on) return;
  ducked = on;
  apply(music, DUCK_MS);
  apply(ambience, DUCK_MS);
}

/** 调试和测试用：两层现在放的是什么。 */
export function musicState(): { music: TrackId | null; ambience: TrackId | null; ducked: boolean } {
  return { music: music.id, ambience: ambience.id, ducked };
}
