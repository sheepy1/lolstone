// 资源加载器：按清单加载头像、原画和语音，报告进度。单个资源加载失败不算错，记下来，画面用纯色兜底、
// 声音不播（美术成品在 git 里；语音没跑 fetch:voice 时全部缺失也能玩）。
// 图片以 HTMLImageElement 保存，场景用 canvas 把它们合成进卡面、头像贴图。public/art 下的图已经由 scripts/optimize-art.ts
// 按显示尺寸缩过（卡面原画窗口 380 像素宽，取景区域留到 1.5 倍），解码后一张最多一两 MB；万一哪张比 MAX_SIDE 大
// （比如本地放了原图），加载完先缩到长边 MAX_SIDE 的 canvas 再存。
import { preloadVoice } from '../audio/voice';
import type { AssetEntry } from './manifest';
import { iconUrl, IMAGE_KINDS } from './manifest';

/** 已加载的图：原图，或缩小后的 canvas。 */
export type ArtImage = HTMLImageElement | HTMLCanvasElement;

const MAX_SIDE = 1024;
const images = new Map<string, ArtImage>(); // url → 已加载的图
const failed = new Set<string>();
const pending = new Map<string, Promise<ArtImage | null>>();

function shrink(img: HTMLImageElement): ArtImage {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const k = MAX_SIDE / Math.max(w, h);
  if (k >= 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function loadImage(url: string): Promise<ArtImage | null> {
  const done = images.get(url);
  if (done) return Promise.resolve(done);
  if (failed.has(url)) return Promise.resolve(null);
  let p = pending.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const out = shrink(img);
        images.set(url, out);
        pending.delete(url);
        resolve(out);
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

export type LoadOptions = {
  /** 同时加载几个。加载页默认全部一起发（浏览器自己排队）；后台加载语音时限到两三个，不和对局音乐抢带宽。 */
  concurrency?: number;
};

// 加载清单里的资源，每完成一个调一次 onProgress（0 到 1）。
export async function loadManifest(entries: readonly AssetEntry[], onProgress: (p: number) => void, opts: LoadOptions = {}): Promise<LoadReport> {
  let done = 0;
  const missing: string[] = [];
  onProgress(entries.length === 0 ? 1 : 0);
  const load = async (e: AssetEntry) => {
    const ok = IMAGE_KINDS.includes(e.kind)
      ? (await loadImage(e.url)) !== null
      : await preloadVoice(e.key, e.kind === 'voice_choose' ? 'choose' : 'ban', e.url);
    if (!ok) missing.push(e.url);
    onProgress(++done / entries.length);
  };
  const limit = Math.max(1, Math.min(opts.concurrency ?? Infinity, entries.length));
  let next = 0;
  const worker = async () => {
    while (next < entries.length) await load(entries[next++]!);
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return { total: entries.length, loaded: entries.length - missing.length, missing };
}

// 按地址取图。没加载过的在后台按需加载，这次先返回 null（调用方用纯色兜底），加载好后 onReady 回调；
// 加载失败（素材没拉、文件缺失）不回调，一直用兜底。
export function artImage(url: string, onReady?: (img: ArtImage) => void): ArtImage | null {
  const img = images.get(url);
  if (img) return img;
  if (!failed.has(url)) void loadImage(url).then((i) => i && onReady?.(i));
  return null;
}

// 英雄头像。
export function portraitImage(championKey: string, onReady?: (img: ArtImage) => void): ArtImage | null {
  return artImage(iconUrl(championKey), onReady);
}
