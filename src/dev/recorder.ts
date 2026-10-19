// 录逐帧画面（m4 战斗事件的验收要录屏帧序列）：完全接管 GSAP 的时钟，按固定步长推进、渲染、存成 JPEG，
// 和页面在不在前台无关。slow = 4 时每帧只推进 1/240 秒（四倍慢放），输出仍按 60 帧拼成视频。
// 做法见 NOTES.md "踩过的坑"：ticker.sleep 之后把 wake 换成空函数，否则 GSAP 建新补间时自己唤醒，两个时钟同时推。
import gsap from 'gsap';
import type { Stage } from '../scene/stage';

export type RecordOptions = {
  stage: Stage;
  name: string; // 存到 .dev-output/rec/<name>/00000.jpg
  slow?: number; // 慢放倍数
  start?: () => void; // 第 0 帧之后调用（开始播放事件）
  done?: () => boolean; // 返回 true 后再录 tail 秒就停
  tail?: number;
  maxSeconds?: number; // 动画时间的上限
  everyNth?: number; // 每几帧存一张（1 是每帧）
  quality?: number;
  onFrame?: (i: number, t: number) => void;
};

const yieldOnce = () =>
  new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

// 画完马上同步取图：等到下一个任务时浏览器可能已经把绘图缓冲交出去并清空了，取到的是黑帧
async function save(url: string, name: string, i: number): Promise<void> {
  await fetch(`/__dev/screenshot?dir=rec/${encodeURIComponent(name)}&name=${String(i).padStart(5, '0')}`, { method: 'POST', body: url });
}

// 返回录了多少帧和这段动画的时长（秒，动画时间）
export async function recordFrames(o: RecordOptions): Promise<{ frames: number; seconds: number }> {
  const dt = 1 / 60 / (o.slow ?? 1);
  const tick = gsap.ticker;
  const wake = tick.wake;
  tick.sleep();
  (tick as unknown as { wake: () => void }).wake = () => {};
  let T = tick.time;
  let t = 0;
  let saved = 0;
  let doneAt = -1;
  const every = o.everyNth ?? 1;
  try {
    for (let i = 0; ; i++) {
      if (i === 1) o.start?.();
      T += dt;
      t += dt;
      gsap.updateRoot(T);
      o.stage.frame(dt);
      const url = i % every === 0 ? o.stage.canvas.toDataURL('image/jpeg', o.quality ?? 0.88) : null;
      await yieldOnce();
      o.onFrame?.(i, t);
      if (url) await save(url, o.name, saved++);
      if (doneAt < 0 && i > 2 && (o.done?.() ?? false)) doneAt = t;
      if (doneAt >= 0 && t - doneAt >= (o.tail ?? 0.4)) break;
      if (t >= (o.maxSeconds ?? 6)) break;
    }
  } finally {
    (tick as unknown as { wake: typeof wake }).wake = wake;
    tick.wake();
  }
  return { frames: saved, seconds: t };
}

// 不存图，只按固定步长推进并量每帧的耗时（渲染后读回一个像素，等 GPU 做完），性能验收用
export async function measureFrames(o: { stage: Stage; start: () => void; done: () => boolean; maxSeconds?: number }): Promise<{ frames: number; avgMs: number; p95Ms: number; maxMs: number; over16: number; worst: [number, number][] }> {
  const dt = 1 / 60;
  const tick = gsap.ticker;
  const wake = tick.wake;
  tick.sleep();
  (tick as unknown as { wake: () => void }).wake = () => {};
  const gl = o.stage.renderer.getContext();
  const px = new Uint8Array(4);
  let T = tick.time;
  const ms: number[] = [];
  try {
    for (let i = 0, t = 0; t < (o.maxSeconds ?? 4); i++, t += dt) {
      if (i === 1) o.start();
      const a = performance.now();
      T += dt;
      gsap.updateRoot(T);
      o.stage.frame(dt);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ms.push(performance.now() - a);
      await yieldOnce();
      if (i > 2 && o.done()) break;
    }
  } finally {
    (tick as unknown as { wake: typeof wake }).wake = wake;
    tick.wake();
  }
  const sorted = [...ms].sort((p, q) => p - q);
  return {
    frames: ms.length,
    avgMs: ms.reduce((s, x) => s + x, 0) / ms.length,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    over16: ms.filter((x) => x > 16.7).length,
    // 最慢的几帧：[帧号, 毫秒]
    worst: ms.map((x, i) => [i, Math.round(x * 10) / 10] as [number, number]).sort((p, q) => q[1] - p[1]).slice(0, 8),
  };
}
