// 资源加载器：按清单预载头像、原画和语音，报告进度。单个资源加载失败不算错，记下来，画面用纯色兜底、
// 声音不播（素材不进 git，没跑 fetch:art / fetch:voice 时全部缺失也能玩）。
import { Assets, Texture } from 'pixi.js';
import { preloadVoice } from '../audio/voice';
import type { AssetEntry } from './manifest';
import { iconUrl } from './manifest';

const icons = new Map<string, Texture>();
const failed = new Set<string>();
const pending = new Map<string, Promise<Texture | null>>();

async function loadTexture(url: string): Promise<Texture | null> {
  if (failed.has(url)) return null;
  try {
    const tex = (await Assets.load<Texture>(url)) as Texture | undefined;
    if (!tex || !(tex instanceof Texture)) throw new Error('not a texture');
    return tex;
  } catch {
    failed.add(url);
    return null;
  }
}

export type LoadReport = { total: number; loaded: number; missing: string[] };

// 依次加载清单里的资源，每完成一个调一次 onProgress（0 到 1）。
export async function loadManifest(entries: readonly AssetEntry[], onProgress: (p: number) => void): Promise<LoadReport> {
  let done = 0;
  const missing: string[] = [];
  const tick = () => onProgress(entries.length === 0 ? 1 : ++done / entries.length);
  onProgress(entries.length === 0 ? 1 : 0);
  // 并发加载，进度按完成个数算
  await Promise.all(
    entries.map(async (e) => {
      let ok: boolean;
      if (e.kind === 'icon' || e.kind === 'loading') {
        const tex = await loadTexture(e.url);
        if (tex && e.kind === 'icon') icons.set(e.key, tex);
        ok = tex !== null;
      } else {
        ok = await preloadVoice(e.key, e.kind === 'voice_choose' ? 'choose' : 'ban', e.url);
      }
      if (!ok) missing.push(e.url);
      tick();
    }),
  );
  return { total: entries.length, loaded: entries.length - missing.length, missing };
}

// 英雄头像。没加载过的在后台按需加载，这次先返回 null（调用方用纯色兜底），加载好后 onReady 回调。
export function portraitTexture(championKey: string, onReady?: (t: Texture) => void): Texture | null {
  const tex = icons.get(championKey);
  if (tex) return tex;
  const url = iconUrl(championKey);
  if (failed.has(url)) return null;
  let p = pending.get(url);
  if (!p) {
    p = loadTexture(url);
    pending.set(url, p);
    void p.then((t) => {
      pending.delete(url);
      if (t) icons.set(championKey, t);
    });
  }
  if (onReady) void p.then((t) => t && onReady(t));
  return null;
}
