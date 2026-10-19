// L2 搜索的 Web Worker 入口（spec 4.4：放到 Web Worker 里跑，避免卡 UI）。和命令行、测试里同步跑的是同一份 createL2。
// Worker 是独立的模块环境，卡池要在这里自己装一次。一个 Worker 里只有一个 L2 实例，它记着上一次搜出的序列，
// 所以同一时刻只给一方用（对局里只有对手是 L2）。
import { installDefaultPool } from '../cards';
import type { GameState, RngState, Side } from '../engine/state';
import { createL2 } from './l2';

installDefaultPool();
const ai = createL2();

export type L2Request = { id: number; state: GameState; side: Side; rng: RngState };
export type L2Response = { id: number; choice: ReturnType<typeof ai>; ms: number } | { id: number; error: string };

// 只用到 Worker 全局的这两样，不引 DOM 的类型（tsconfig.json 里 src/ai 按 Node 环境检查）
const scope = globalThis as unknown as { onmessage: ((e: { data: L2Request }) => void) | null; postMessage: (m: L2Response) => void };

scope.onmessage = (e) => {
  const { id, state, side, rng } = e.data;
  const t0 = performance.now();
  try {
    scope.postMessage({ id, choice: ai(state, side, rng), ms: performance.now() - t0 });
  } catch (err) {
    scope.postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
