// 浏览器里调用 L2 的异步接口：把遮过的局面发给 Web Worker（l2.worker.ts），等它回下一个动作，主线程不卡。
// 没有 Worker 的环境（Node、测试）退回到同一份 createL2 同步跑，包成 Promise。
import type { GameState, RngState, Side } from '../engine/state';
import { createL2 } from './l2';
import type { L2Request, L2Response } from './l2.worker';
import type { AiChoice } from './types';

export type AsyncChooseAction = (state: GameState, side: Side, rng: RngState) => Promise<AiChoice | null>;

// tsconfig.json 里 src/ai 按 Node 环境检查（没有 DOM 类型），这里只声明用到的那一点。写成 new Worker(new URL(...)) 的原样，
// Vite 才认得出来、把 Worker 单独打包
type WorkerLike = { postMessage(m: L2Request): void; onmessage: ((e: { data: L2Response }) => void) | null; onerror: ((e: unknown) => void) | null };
declare const Worker: (new (url: URL, opts: { type: 'module' }) => WorkerLike) | undefined;

let shared: AsyncChooseAction | null = null;

// 整个页面共用一个 Worker（第一次用到时建，之后各局复用）。同一时刻只有一局、一个对手在用。
export function l2Async(): AsyncChooseAction {
  if (shared) return shared;
  if (typeof Worker === 'undefined') {
    const sync = createL2();
    shared = async (state, side, rng) => sync(state, side, rng);
    return shared;
  }
  const worker = new Worker(new URL('./l2.worker.ts', import.meta.url), { type: 'module' });
  const waiting = new Map<number, { resolve: (c: AiChoice | null) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  worker.onmessage = (e) => {
    const r = e.data;
    const w = waiting.get(r.id);
    if (!w) return;
    waiting.delete(r.id);
    if ('error' in r) w.reject(new Error(`L2 worker: ${r.error}`));
    else w.resolve(r.choice);
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(`L2 worker failed: ${String((e as { message?: string })?.message ?? e)}`));
    waiting.clear();
  };
  shared = (state, side, rng) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, state, side, rng });
    });
  return shared;
}
