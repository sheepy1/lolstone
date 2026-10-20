// 长帧记录（开发用）：在主应用里自动打一整局，接管 GSAP 的时钟按 1/60 秒一帧推进，每帧渲染后读回一个像素等 GPU 做完，
// 记下耗时超过阈值的帧和那一刻正在播的步。用来找"第一次用到某个效果才卡一帧"的地方（着色器现编译、贴图上传、卡面现画）。
// 控制台：const lf = await import('/src/dev/longFrames.ts'); await lf.recordMatch({ seed: 401 })
// 不依赖页面在前台（不用 requestAnimationFrame），机器上别的会话抢 GPU 时绝对值会偏高，只做前后对比。
import type { GameApp } from '../app/game';
import type { Difficulty } from '../ui/menuData';
import type { HeroClass } from '../engine';

export type LongFrame = { frame: number; t: number; ms: number; update: number; render: number; step: string; sinceStep: number };
// 第一次用到才建的东西：新编译的着色器程序（按材质类型和缓存键）、新上传的贴图张数。浏览器有着色器的磁盘缓存，
// 第二次打开页面时现编译可能很快、看不出长帧，所以光看帧耗时不够，要直接数"对局中途新建了几个程序"
export type FirstUse = { frame: number; t: number; ms: number; step: string; programs: string[]; links: number; textures: number; geometries: number };
export type MatchReport = {
  frames: number;
  seconds: number;
  long: LongFrame[];
  over: boolean;
  errors: number;
  firstFrameMs: number;
  firsts: { t: number; step: string }[];
  uses: FirstUse[];
  programsAtStart: number;
  programsAtEnd: number;
  linksAtStart: number; // 第一帧结束时累计编译了几个程序
  linksAfter: number; // 第一帧之后又编译了几个
};

type Opts = {
  seed: number;
  human?: HeroClass;
  ai?: HeroClass;
  difficulty?: Difficulty;
  threshold?: number; // 毫秒
  maxSeconds?: number; // 动画时间上限
};

const yieldOnce = () =>
  new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

export async function recordMatch(o: Opts): Promise<MatchReport> {
  const app = (window as unknown as { lolstone: GameApp }).lolstone;
  const threshold = o.threshold ?? 50;
  const stage0 = (app as unknown as { stage: { renderer: { setAnimationLoop(f: (() => void) | null): void }; frame(dt?: number): void } }).stage;
  // 停掉舞台自己的渲染循环，只在下面手动渲染：不然它在别的时刻先把着色器编译掉，长帧记在别处
  stage0.renderer.setAnimationLoop(null);
  await app.startMatch(o.human ?? 'ionia', o.ai ?? 'freljord', o.seed, o.difficulty ?? 'l2');
  const s = app.current!;
  const d = s.director;
  const stage = (app as unknown as { stage: { frame(dt?: number): void; renderer: { getContext(): WebGL2RenderingContext } } }).stage;
  const g = app.gsap;
  // 自动驾驶：玩家这一方随机选合法动作，按原速播（不快进）
  s.player.fastForward = () => {};
  app.autoplay(true);
  let step = '(开局)';
  let stepAt = 0;
  let t = 0;
  type Ev = { kind: string; card?: { cardId: string }; cardId?: string };
  type Play = (st: { events: Ev[] }, ...rest: unknown[]) => unknown;
  const holder = d as unknown as { player: Play };
  const orig = holder.player;
  const seenKinds = new Set<string>();
  const firsts: { t: number; step: string }[] = [];
  holder.player = (st, ...rest) => {
    step = st.events.map((e) => e.kind + (e.card ? `:${e.card.cardId}` : e.cardId ? `:${e.cardId}` : '')).join(',');
    stepAt = t;
    // 每种事件第一次出现的时刻（第一次用到某个效果）
    const fresh = st.events.map((e) => e.kind).filter((k) => !seenKinds.has(k));
    if (fresh.length > 0) {
      fresh.forEach((k) => seenKinds.add(k));
      firsts.push({ t: +t.toFixed(2), step });
    }
    return orig(st, ...rest);
  };
  type Info = { programs: { name: string; cacheKey: string }[] | null; memory: { textures: number; geometries: number } };
  const info = (stage.renderer as unknown as { info: Info }).info;
  const uses: FirstUse[] = [];
  const known = new Set<string>();
  let programsAtStart = 0;
  let texturesBefore = 0;
  let geometriesBefore = 0;
  // 新程序是哪个物件用上的：在场景里找当前程序的缓存键对得上的材质，报出物件名、材质类型和往上几层父物件的类型
  const props = (stage.renderer as unknown as { properties: { get(m: object): { currentProgram?: { cacheKey: string } } } }).properties;
  const scene3 = (stage as unknown as { scene: { traverse(f: (o: { type: string; name: string; material?: unknown; parent: unknown }) => void): void } }).scene;
  const ownerOf = (key: string): string => {
    let found = '?';
    scene3.traverse((o) => {
      if (found !== '?' || !o.material) return;
      for (const m of ([] as { type: string; name: string }[]).concat(o.material as never)) {
        if (props.get(m).currentProgram?.cacheKey !== key) continue;
        const chain: string[] = [];
        let p = o as { type: string; name: string; parent: unknown; constructor: { name: string } } | null;
        for (let i = 0; p && i < 4; i++, p = p.parent as typeof p) chain.push(p.name || p.constructor.name);
        found = `${m.type}${m.name ? `(${m.name})` : ''} @ ${chain.join(' < ')}`;
      }
    });
    return found;
  };
  const gl = stage.renderer.getContext();
  // 真正的编译次数：数 linkProgram。程序被释放后再用到时缓存键不变、但要重新编译，只看程序表会漏掉
  let links = 0;
  const link = gl.linkProgram.bind(gl);
  gl.linkProgram = (p: WebGLProgram) => {
    links += 1;
    link(p);
  };
  let linksBefore = 0;
  let linksAtStart = 0;
  const px = new Uint8Array(4);
  g.ticker.sleep();
  const wake = g.ticker.wake;
  (g.ticker as unknown as { wake: () => void }).wake = () => {};
  const tl = g.globalTimeline as unknown as { _start: number; time(): number };
  let T = tl._start + tl.time();
  const long: LongFrame[] = [];
  let frames = 0;
  let firstFrameMs = 0;
  try {
    for (; t < (o.maxSeconds ?? 900); frames++) {
      const a = performance.now();
      T += 1 / 60;
      t += 1 / 60;
      g.updateRoot(T);
      const b = performance.now();
      stage.frame(1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const c = performance.now();
      const ms = c - a;
      if (frames === 0) firstFrameMs = ms;
      const progs = info.programs ?? [];
      const fresh = progs.filter((p) => !known.has(p.cacheKey));
      fresh.forEach((p) => known.add(p.cacheKey));
      const tex = info.memory.textures;
      const geo = info.memory.geometries;
      if (frames === 0) {
        programsAtStart = progs.length;
        linksAtStart = links;
      } else if (fresh.length > 0 || tex > texturesBefore || links > linksBefore) {
        uses.push({ frame: frames, t: +t.toFixed(2), ms: Math.round(ms), step, programs: fresh.map((p) => `${p.name || p.cacheKey.slice(0, 40)} ← ${ownerOf(p.cacheKey)}`), links: links - linksBefore, textures: tex - texturesBefore, geometries: geo - geometriesBefore });
      }
      linksBefore = links;
      texturesBefore = Math.max(texturesBefore, tex);
      geometriesBefore = Math.max(geometriesBefore, geo);
      if (ms > threshold) long.push({ frame: frames, t: +t.toFixed(2), ms: Math.round(ms), update: Math.round(b - a), render: Math.round(c - b), step, sinceStep: +(t - stepAt).toFixed(2) });
      await yieldOnce();
      if (s.match?.over && !d.busy) break;
    }
  } finally {
    (g.ticker as unknown as { wake: typeof wake }).wake = wake;
    g.ticker.wake();
    app.autoplay(false);
    stage0.renderer.setAnimationLoop(() => stage0.frame());
    gl.linkProgram = link;
  }
  return { frames, seconds: +t.toFixed(1), long, over: !!s.match?.over, errors: d.errors.length, firstFrameMs: Math.round(firstFrameMs), firsts, uses, programsAtStart, programsAtEnd: (info.programs ?? []).length, linksAtStart, linksAfter: links - linksAtStart };
}
