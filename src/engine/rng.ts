// 种子随机数（spec 2.11、4.5）。mulberry32，状态是一个 32 位整数，可 JSON 序列化。
import type { GameState, RngState } from './state';

export function seedRng(seed: number): RngState {
  return { s: hash32(seed >>> 0, 0x9e3779b9) };
}

// 返回 [0, 1) 的浮点数和推进后的状态。纯函数。
export function nextFloat(rng: RngState): [number, RngState] {
  const s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, { s }];
}

// 返回 [0, n) 的整数。n 必须大于 0。
export function nextInt(rng: RngState, n: number): [number, RngState] {
  const [f, next] = nextFloat(rng);
  return [Math.floor(f * n), next];
}

// Fisher-Yates 洗牌，返回新数组。
export function shuffle<T>(rng: RngState, items: readonly T[]): [T[], RngState] {
  const out = items.slice();
  let r = rng;
  for (let i = out.length - 1; i > 0; i--) {
    let j: number;
    [j, r] = nextInt(r, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, r];
}

// 给模拟用的独立随机数流：由局面当前的随机数状态和 salt 派生，不推进局面里的状态。
// 同一局面、同一 salt 得到同一条流；不同 salt 得到互不相关的流。
export function forkRng(state: Pick<GameState, 'rng'>, salt = 0): RngState {
  return { s: hash32(state.rng.s ^ 0x5bd1e995, (salt >>> 0) + 0x27d4eb2d) };
}

function hash32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x85ebca6b, 0xc2b2ae35) ^ b;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
