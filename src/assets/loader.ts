// 资源加载器：按清单预载头像、原画和语音，报告进度。单个资源加载失败不算错，记下来，画面用纯色兜底、
// 声音不播（素材不进 git，没跑 fetch:art / fetch:voice 时全部缺失也能玩）。
// 图片以 HTMLImageElement 保存，场景用 canvas 把它们合成进卡面、头像贴图。
import { preloadVoice } from '../audio/voice';
import type { AssetEntry } from './manifest';
import { iconUrl } from './manifest';

const images = new Map<string, HTMLImageElement>(); // url → 已加载的图
const failed = new Set<string>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const done = images.get(url);
  if (done) return Promise.resolve(done);
  if (failed.has(url)) return Promise.resolve(null);
  let p = pending.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        images.set(url, img);
        pending.delete(url);
        resolve(img);
      };
      img.onerror = () => {
        failed.add(url);
        pending.delete(url);
        resolve(null);
      };
      img.src = url;
    });
    pending.set(url, p);
  }
  return p;
}

export type LoadReport = { total: number; loaded: number; missing: string[] };

// 并发加载清单里的资源，每完成一个调一次 onProgress（0 到 1）。
export async function loadManifest(entries: readonly AssetEntry[], onProgress: (p: number) => void): Promise<LoadReport> {
  let done = 0;
  const missing: string[] = [];
  onProgress(entries.length === 0 ? 1 : 0);
  await Promise.all(
    entries.map(async (e) => {
      const ok =
        e.kind === 'icon' || e.kind === 'loading'
          ? (await loadImage(e.url)) !== null
          : await preloadVoice(e.key, e.kind === 'voice_choose' ? 'choose' : 'ban', e.url);
      if (!ok) missing.push(e.url);
      onProgress(++done / entries.length);
    }),
  );
  return { total: entries.length, loaded: entries.length - missing.length, missing };
}

// 英雄头像。没加载过的在后台按需加载，这次先返回 null（调用方用纯色兜底），加载好后 onReady 回调。
export function portraitImage(championKey: string, onReady?: (img: HTMLImageElement) => void): HTMLImageElement | null {
  const url = iconUrl(championKey);
  const img = images.get(url);
  if (img) return img;
  if (!failed.has(url)) void loadImage(url).then((i) => i && onReady?.(i));
  return null;
}
