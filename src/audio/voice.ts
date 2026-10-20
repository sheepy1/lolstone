// 英雄语音（spec 5.7）：入场说选用语音，死亡说禁用语音。同一时刻只播一条，新的来了打断旧的；
// 播放时音乐和环境音压低，播完恢复。
// 语音不进加载页：开局后 game.ts 按 matchVoiceManifest 在后台加载，还没加载好时触发的台词不播、也不补播。
import { Howl } from 'howler';
import { voiceUrl } from '../assets/manifest';
import { channelVolume } from './channels';
import { withMp3 } from './files';
import { duckMusic } from './music';

type Which = 'choose' | 'ban';

const voices = new Map<string, Howl | null>(); // null：加载失败
const pending = new Map<string, Promise<boolean>>(); // 正在加载的，同一条不重复建 Howl

const keyOf = (champion: string, which: Which) => `${champion}:${which}`;

// 预载一条语音，成功返回 true。
export function preloadVoice(champion: string, which: Which, url = voiceUrl(champion, which)): Promise<boolean> {
  const key = keyOf(champion, which);
  const known = voices.get(key);
  if (known !== undefined) return Promise.resolve(known !== null);
  let p = pending.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      const h = new Howl({
        // normalize-audio 在 ogg 旁边生成同名 mp3，浏览器不支持 ogg 时用它
        src: withMp3(url),
        preload: true,
        onload: () => {
          voices.set(key, h);
          pending.delete(key);
          resolve(true);
        },
        onloaderror: () => {
          voices.set(key, null);
          pending.delete(key);
          resolve(false);
        },
      });
    });
    pending.set(key, p);
  }
  return p;
}

let current: Howl | null = null;

export function playVoice(champion: string, which: Which): void {
  const h = voices.get(keyOf(champion, which));
  if (!h) {
    // 没加载过的按需加载，这次不播
    if (h === undefined) void preloadVoice(champion, which);
    return;
  }
  if (current && current !== h) current.stop();
  current = h;
  h.stop();
  h.volume(channelVolume('voice'));
  duckMusic(true);
  h.once('end', () => {
    if (current === h) {
      current = null;
      duckMusic(false);
    }
  });
  h.play();
}
