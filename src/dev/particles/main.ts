// 粒子预设演示页（分镜表 1.5，只在开发服务器里用）：pnpm dev 后打开 /src/dev/particles/。
// 一块固定的中盘棋盘，逐个触发 18 个粒子预设，改 count、dir、color、scale、飞行时长，慢放，显示粒子数和帧率。
// 控制台 pfx：截图、逐帧录制、性能测试（自动化验证用，见 NOTES.md 的"粒子系统"一节）。
import gsap from 'gsap';
import GUI from 'lil-gui';
import * as THREE from 'three';
import { l0ChooseAction } from '../../ai/l0';
import { installDefaultPool, PRESET_DECKS } from '../../cards';
import { applyAction, createGame, seedRng, type GameState, type RngState, type Side } from '../../engine';
import {
  driveWithGsap,
  MAX_PARTICLES,
  ParticleSystem,
  PRESET_NAMES,
  presetParticleCount,
  type EmitOptions,
  type PresetDef,
  type PresetName,
  type Vec3Like,
} from '../../presentation/fx/particles';
import { boardSlot, burnSlot, heroSlot, showcaseSlot } from '../../presentation/layout';
import { viewFromState } from '../../presentation/viewState';
import { Stage } from '../../scene/stage';
import { TableScene } from '../../scene/table';

installDefaultPool();

// 和 /dev/fx 一样的基准棋盘：固定种子的 L0 对 L0 打到中盘，双方场上都有随从
function benchState(): GameState {
  for (let seed = 1; seed < 200; seed++) {
    let state = createGame({ seed, classes: ['ionia', 'noxus'], decks: [[...PRESET_DECKS.ionia!], [...PRESET_DECKS.noxus!]] }).state;
    const rngs: [RngState, RngState] = [seedRng(seed), seedRng(seed + 1)];
    for (let n = 0; n < 400 && state.phase !== 'over'; n++) {
      const side: Side = state.phase === 'mulligan' ? (state.players[0].mulliganDone ? 1 : 0) : state.current;
      if (state.phase === 'playing' && state.turn >= 9 && side === 0 && state.players[0].board.length >= 2 && state.players[1].board.length >= 2) return state;
      const c = l0ChooseAction(state, side, rngs[side]);
      if (!c) break;
      rngs[side] = c.rng;
      const r = applyAction(state, c.action);
      if (!r.ok) break;
      state = r.state;
    }
  }
  throw new Error('没有找到合适的中盘局面');
}

const view = viewFromState(benchState(), 0);
const stage = new Stage(document.getElementById('stage')!);
const table = new TableScene(view, stage);
const sys = new ParticleSystem({ camera: stage.camera });
stage.scene.add(sys.object);
let undrive: (() => void) | null = driveWithGsap(sys);
const hud = document.getElementById('hud')!;
const log = document.getElementById('log')!;

// ---------- 场景里的落点 ----------

const near = view.players[0].board.length;
const far = view.players[1].board.length;
const up = (p: Vec3Like, y: number): Vec3Like => ({ x: p.x, y: p.y + y, z: p.z });
const ANCHORS = {
  我方随从: () => boardSlot('near', Math.min(1, near - 1), near).pos,
  敌方随从: () => boardSlot('far', Math.min(1, far - 1), far).pos,
  我方空槽: () => boardSlot('near', near, near + 1).pos,
  我方枢纽: () => heroSlot('near').pos,
  敌方枢纽: () => heroSlot('far').pos,
  棋盘中央: () => ({ x: 0, y: 0, z: 0 }),
  爆牌位: () => burnSlot('near').pos,
  展示位: () => showcaseSlot().pos,
} as const;
type AnchorName = keyof typeof ANCHORS;

// 每个预设在分镜里的典型落点（E07 到 E29）
const SCENARIO: Record<PresetName, { at: AnchorName; y?: number; to?: AnchorName; toY?: number }> = {
  dust_land: { at: '我方随从' },
  spark_light: { at: '敌方随从', y: 0.4 },
  spark_heavy: { at: '敌方随从', y: 0.4 },
  fire_bolt: { at: '展示位', to: '敌方随从', toY: 0.4 },
  frost_spread: { at: '敌方随从' },
  ice_shatter: { at: '敌方随从', y: 0.2 },
  holy_pillar: { at: '我方随从' },
  shadow_gather: { at: '敌方随从' },
  slash_trail: { at: '敌方随从', y: 0.5 },
  shield_break: { at: '我方随从', y: 0.3 },
  death_shards: { at: '敌方随从', y: 0.3 },
  heal_motes: { at: '我方随从' },
  buff_ring: { at: '我方随从' },
  stealth_smoke: { at: '我方随从' },
  summon_gather: { at: '我方空槽' },
  victory_confetti: { at: '棋盘中央' },
  burn_ash: { at: '爆牌位' },
  nexus_burst: { at: '敌方枢纽' },
};

const settings = {
  preset: 'spark_heavy' as PresetName,
  at: '（分镜默认）' as string,
  count: 0,
  scale: 1,
  dir: '（预设默认）' as string,
  overrideColor: false,
  color: '#ff7ad9',
  duration: 0,
  slow: false,
  speed: 1,
  bloom: true,
  softDepth: false,
  hideTable: false,
  trigger: () => trigger(),
  cycle: () => void cycle(),
  heavy5: () => heavy5(),
  fill: () => fill(),
  clear: () => sys.killAll(),
};

function optionsFor(name: PresetName, over: Partial<typeof settings> = settings): EmitOptions {
  const sc = SCENARIO[name];
  const atName = over.at && over.at in ANCHORS ? (over.at as AnchorName) : sc.at;
  const opts: EmitOptions = { at: up(ANCHORS[atName](), sc.y ?? 0) };
  if (sc.to) opts.to = up(ANCHORS[sc.to](), sc.toY ?? 0);
  if (over.count) opts.count = over.count;
  if (over.scale && over.scale !== 1) opts.scale = over.scale;
  if (over.dir && !over.dir.startsWith('（')) {
    opts.dir = over.dir as EmitOptions['dir'];
    if (opts.dir === 'toward' && !opts.to) opts.to = up(ANCHORS['我方枢纽'](), 0.5);
  }
  if (over.overrideColor) opts.color = over.color;
  if (over.duration) opts.duration = over.duration;
  return opts;
}

function trigger(name = settings.preset): void {
  sys.emit(name, optionsFor(name));
  log.textContent = `${name}`;
}

async function cycle(): Promise<void> {
  for (const name of PRESET_NAMES) {
    settings.preset = name;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    trigger(name);
    await gsap.delayedCall(name === 'victory_confetti' ? 3 : 1.4, () => {});
  }
}

// 默认参数下粒子最多的 5 个
const HEAVY5 = [...PRESET_NAMES].sort((a, b) => presetParticleCount(b) - presetParticleCount(a)).slice(0, 5);

function heavy5(): void {
  for (const name of HEAVY5) sys.emit(name, optionsFor(name, {}));
  log.textContent = `同时触发：${HEAVY5.map((n) => `${n}(${presetParticleCount(n)})`).join('、')}`;
}

// 打满 2000：三种混合方式都有、寿命 4 秒，按比例 4:3:3（烟、光、泛光火花）；fixed 关掉数量随机，正好 2000
const STRESS: PresetDef = {
  count: MAX_PARTICLES,
  dir: 'out',
  color: 0xff9a3c,
  layers: [
    { name: 'smoke', fixed: true, count: 800, life: 4, shape: { kind: 'disc', radius: 6, height: [0.2, 3] }, dir: 'up', speed: [0.05, 0.2], size: [0.4, 0.8], alphaCurve: [[0, 0], [0.1, 0.4], [0.9, 0.4], [1, 0]], gradient: [[0, 0x6a6460, 1]], cell: 'smoke', blend: 'alpha', align: 'billboard', spin: [0.2, 0.8], soft: true },
    { name: 'glow', fixed: true, count: 600, life: 4, shape: { kind: 'disc', radius: 6, height: [0.2, 3] }, dir: 'up', speed: [0.05, 0.3], size: [0.2, 0.4], alphaCurve: [[0, 0], [0.1, 0.8], [0.9, 0.8], [1, 0]], gradient: [[0, 'main', 1.5]], cell: 'glow', blend: 'add', align: 'billboard' },
    { name: 'sparks', fixed: true, count: 600, life: 4, shape: { kind: 'disc', radius: 6, height: [0.2, 3] }, dir: 'out', speed: [0.3, 0.8], swirl: 0.5, size: 0.06, stretch: 0.2, alphaCurve: [[0, 0], [0.1, 1], [0.9, 1], [1, 0]], gradient: [[0, 'hot', 3]], cell: 'ember', blend: 'add', bloom: true, align: 'velocity' },
  ],
};

function fill(): void {
  sys.killAll();
  sys.emit(STRESS, { at: { x: 0, y: 0, z: 0.5 } });
  log.textContent = `打满 ${MAX_PARTICLES}`;
}

// ---------- 软粒子（场景深度预渲染，可选） ----------

let depthTarget: THREE.WebGLRenderTarget | null = null;
let unhookDepth: (() => void) | null = null;
function applySoftDepth(): void {
  if (settings.softDepth && !depthTarget) {
    const size = stage.renderer.getDrawingBufferSize(new THREE.Vector2());
    depthTarget = new THREE.WebGLRenderTarget(size.x, size.y, { depthTexture: new THREE.DepthTexture(size.x, size.y) });
    sys.setSoftDepth(depthTarget.depthTexture, stage.camera, size.x, size.y);
    unhookDepth = stage.onFrame(() => {
      sys.object.visible = false;
      stage.renderer.setRenderTarget(depthTarget);
      stage.renderer.render(stage.scene, stage.camera);
      stage.renderer.setRenderTarget(null);
      sys.object.visible = true;
    });
  } else if (!settings.softDepth && depthTarget) {
    unhookDepth?.();
    sys.setSoftDepth(null);
    depthTarget.dispose();
    depthTarget = null;
  }
}

function applySettings(): void {
  gsap.globalTimeline.timeScale(settings.slow ? 0.1 * settings.speed : settings.speed);
  stage.bloom.intensity = settings.bloom ? 1 : 0;
  table.root.visible = !settings.hideTable;
  applySoftDepth();
}

const gui = new GUI({ title: '粒子预设（分镜表 1.5）' });
const g1 = gui.addFolder('预设');
g1.add(settings, 'preset', [...PRESET_NAMES]).name('预设');
g1.add(settings, 'at', ['（分镜默认）', ...Object.keys(ANCHORS)]).name('位置');
g1.add(settings, 'count', 0, 400, 1).name('count（0 = 默认）');
g1.add(settings, 'scale', 0.25, 4, 0.05).name('scale');
g1.add(settings, 'dir', ['（预设默认）', 'up', 'out', 'in', 'toward']).name('dir');
g1.add(settings, 'overrideColor').name('覆盖 color');
g1.addColor(settings, 'color').name('color');
g1.add(settings, 'duration', 0, 1.5, 0.01).name('飞行时长（0 = 默认）');
g1.add(settings, 'trigger').name('触发（空格）');
g1.add(settings, 'cycle').name('逐个演示全部');
const g2 = gui.addFolder('时间与画面');
g2.add(settings, 'slow').name('慢放 0.1 倍（S）').onChange(applySettings);
g2.add(settings, 'speed', 0.05, 3, 0.05).name('全局速度').onChange(applySettings);
g2.add(settings, 'bloom').name('泛光').onChange(applySettings);
g2.add(settings, 'softDepth').name('软粒子用场景深度').onChange(applySettings);
g2.add(settings, 'hideTable').name('隐藏棋盘').onChange(applySettings);
const g3 = gui.addFolder('压力');
g3.add(settings, 'heavy5').name('最重的 5 个同时');
g3.add(settings, 'fill').name(`打满 ${MAX_PARTICLES}`);
g3.add(settings, 'clear').name('清空');

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    trigger();
  }
  if (e.code === 'KeyS') {
    settings.slow = !settings.slow;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    applySettings();
  }
});

// ---------- HUD：帧率、单帧耗时、粒子数 ----------

// 渲染耗时：给后处理的 render 包一层计时（只是 CPU 提交时间，GPU 时间看 pfx.bench 的同步测量）
let renderMs = 0;
const composerRender = stage.composer.render.bind(stage.composer);
stage.composer.render = (dt?: number) => {
  const t = performance.now();
  composerRender(dt);
  renderMs = performance.now() - t;
};

const frames: number[] = [];
let lastFrame = performance.now();
let hudAt = 0;
function hudLoop(): void {
  const t = performance.now();
  frames.push(t - lastFrame);
  lastFrame = t;
  if (frames.length > 60) frames.shift();
  if (t - hudAt > 200) {
    hudAt = t;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    const worst = Math.max(...frames);
    const s = sys.stats;
    const size = stage.renderer.getDrawingBufferSize(new THREE.Vector2());
    hud.textContent = [
      `fps ${(1000 / avg).toFixed(1)}  帧间隔 ${avg.toFixed(2)}ms（最差 ${worst.toFixed(1)}）`,
      `粒子 ${s.live} / ${MAX_PARTICLES}  丢弃 ${s.dropped}  发射中 ${s.handles}  绘制 ${s.drawCalls}`,
      `update ${s.updateMs.toFixed(2)}ms  render ${renderMs.toFixed(2)}ms`,
      `画布 ${size.x}×${size.y}  速度 ×${gsap.globalTimeline.timeScale().toFixed(2)}`,
    ].join('\n');
  }
  requestAnimationFrame(hudLoop);
}
requestAnimationFrame(hudLoop);
applySettings();

// ---------- 自动化：截图、逐帧录制、性能测试 ----------

async function save(name: string): Promise<string> {
  const url = stage.canvas.toDataURL('image/png');
  const r = await fetch(`/__dev/screenshot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
  return r.text();
}

// 手动推进时间：停掉 GSAP 驱动，按固定步长更新粒子，到每个时刻渲染一帧存下来。不依赖页面在不在前台。
async function capture(name: PresetName, timesMs: number[], prefix: string = name, over: Partial<typeof settings> = {}): Promise<string[]> {
  undrive?.();
  undrive = null;
  sys.killAll();
  sys.timeScale = 1;
  const out: string[] = [];
  sys.emit(name, optionsFor(name, over));
  let t = 0;
  const step = 1 / 240;
  for (const target of timesMs) {
    while (t < target / 1000 - 1e-9) {
      sys.update(step);
      t += step;
    }
    stage.frame();
    out.push(await save(`${prefix}-${String(Math.round(target)).padStart(4, '0')}`));
  }
  sys.killAll();
  undrive = driveWithGsap(sys);
  return out;
}

// 每个预设最有看头的时刻（毫秒），18 张截图各截这一帧
const PEAK: Record<PresetName, number> = {
  dust_land: 150,
  spark_light: 60,
  spark_heavy: 80,
  fire_bolt: 150,
  frost_spread: 200,
  ice_shatter: 120,
  holy_pillar: 250,
  shadow_gather: 200,
  slash_trail: 100,
  shield_break: 100,
  death_shards: 200,
  heal_motes: 300,
  buff_ring: 200,
  stealth_smoke: 250,
  summon_gather: 180,
  victory_confetti: 1500,
  burn_ash: 350,
  nexus_burst: 150,
};

async function shots(prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of PRESET_NAMES) out.push(...(await capture(name, [PEAK[name]], `${prefix}-${name}`)));
  return out;
}

type BenchResult = { label: string; frames: number; fps: number; avgFrameMs: number; p95FrameMs: number; avgUpdateMs: number; avgRenderMs: number; avgBlockingMs: number; peakLive: number; dropped: number; canvas: string };

// 性能：按 rAF 实测帧间隔；另外每帧在渲染后 readPixels 一个像素强制等 GPU 做完，记"更新 + 渲染 + 等 GPU"的同步耗时。
async function bench(mode: 'heavy5' | 'fill' | 'idle', seconds = 3): Promise<BenchResult> {
  sys.killAll();
  const gl = stage.renderer.getContext();
  const px = new Uint8Array(4);
  const intervals: number[] = [];
  const updates: number[] = [];
  const renders: number[] = [];
  const blocking: number[] = [];
  let peak = 0;
  const dropped0 = sys.dropped;
  const origFrame = stage.frame.bind(stage);
  stage.frame = () => {
    const t0 = performance.now();
    origFrame();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    blocking.push(performance.now() - t0 + sys.stats.updateMs);
    renders.push(renderMs);
    updates.push(sys.stats.updateMs);
    peak = Math.max(peak, sys.live);
  };
  if (mode === 'heavy5') heavy5();
  if (mode === 'fill') {
    fill();
    // 等它发满再开始记
    await new Promise((r) => setTimeout(r, 300));
    intervals.length = 0;
  }
  let last = performance.now();
  const end = last + seconds * 1000;
  await new Promise<void>((resolve) => {
    const loop = () => {
      const t = performance.now();
      intervals.push(t - last);
      last = t;
      if (t < end) requestAnimationFrame(loop);
      else resolve();
    };
    requestAnimationFrame(loop);
  });
  stage.frame = origFrame;
  sys.killAll();
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const sorted = [...intervals].sort((a, b) => a - b);
  const size = stage.renderer.getDrawingBufferSize(new THREE.Vector2());
  return {
    label: mode === 'heavy5' ? `同时触发 ${HEAVY5.join('、')}` : mode === 'fill' ? `粒子打满 ${MAX_PARTICLES}` : '空场景',
    frames: intervals.length,
    fps: 1000 / avg(intervals),
    avgFrameMs: avg(intervals),
    p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    avgUpdateMs: avg(updates),
    avgRenderMs: avg(renders),
    avgBlockingMs: avg(blocking),
    peakLive: peak,
    dropped: sys.dropped - dropped0,
    canvas: `${size.x}×${size.y} @dpr ${stage.renderer.getPixelRatio()}`,
  };
}

(window as unknown as { pfx: unknown }).pfx = {
  sys,
  stage,
  table,
  settings,
  gsap,
  trigger,
  heavy5,
  fill,
  save,
  capture,
  shots,
  PEAK,
  bench,
  HEAVY5,
  optionsFor,
  set(over: Partial<typeof settings>) {
    Object.assign(settings, over);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    applySettings();
  },
};
