// 动画调试台 /dev/fx（spec 6.1、6.2，只进开发构建）：在一块固定的中盘棋盘上单独触发任意一种事件的动画，
// 慢放、改整步时长和缓动曲线、调光照和泛光；GSDevTools 接在最近一步的时间线上，可以拖时间轴。
// M4 在这里逐条打磨动画：试出满意的时长和曲线后写回 src/presentation/animations 里对应的模块。
import gsap from 'gsap';
import { GSDevTools } from 'gsap/GSDevTools';
import GUI from 'lil-gui';
import { l0ChooseAction } from '../../ai/l0';
import { installDefaultPool, PRESET_DECKS } from '../../cards';
import { applyAction, createGame, seedRng, type Fx, type GameState, type RngState, type Side } from '../../engine';
import { Director } from '../../presentation/director';
import { PRESENTATION_EVENT_KINDS, type PresentationEventKind } from '../../presentation/events';
import { createGsapPlayer, type GsapPlayer } from '../../presentation/player';
import { viewFromState, type ViewState } from '../../presentation/viewState';
import { Stage } from '../../scene/stage';
import { TableScene } from '../../scene/table';
import { sampleEvents } from '../sampleEvents';

gsap.registerPlugin(GSDevTools);
installDefaultPool();

// 固定种子的 L0 对 L0 打到中盘：双方场上都有随从、轮到玩家 0，作为调试台的基准棋盘
function benchState(): GameState {
  for (let seed = 1; seed < 200; seed++) {
    let state = createGame({ seed, classes: ['ionia', 'noxus'], decks: [[...PRESET_DECKS.ionia!], [...PRESET_DECKS.noxus!]] }).state;
    const rngs: [RngState, RngState] = [seedRng(seed), seedRng(seed + 1)];
    for (let n = 0; n < 400 && state.phase !== 'over'; n++) {
      const side: Side = state.phase === 'mulligan' ? (state.players[0].mulliganDone ? 1 : 0) : state.current;
      if (state.phase === 'playing' && state.turn >= 9 && side === 0 && state.players[0].board.length >= 2 && state.players[1].board.length >= 2 && state.players[0].hand.length >= 4) return state;
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

const base: ViewState = viewFromState(benchState(), 0);
const stage = new Stage(document.getElementById('stage')!);
const log = document.getElementById('log')!;

type Bench = { scene: TableScene; director: Director; player: GsapPlayer };
let bench: Bench | null = null;
let devtools: GSDevTools | null = null;

const settings = {
  kind: 'attack' as PresentationEventKind,
  fx: 'fire' as Fx,
  timeScale: 1,
  duration: 1,
  ease: '（模块自己的）',
  sun: 1.9,
  hemi: 0.85,
  bloomIntensity: 1.0,
  bloomRadius: 0.55,
  play: () => play(),
  reset: () => build(),
};

function build(): void {
  if (bench) {
    for (const t of gsap.globalTimeline.getChildren(false, true, true)) t.kill();
    bench.scene.dispose();
  }
  const scene = new TableScene(base, stage);
  const player = createGsapPlayer(scene);
  player.resetSpeed = () => {}; // 慢放由调试台控制，队列播空时不改回 1 倍
  player.onTimeline = (tl) => {
    devtools?.kill();
    devtools = GSDevTools.create({ animation: tl, container: document.body, minimal: false, persist: false });
  };
  bench = { scene, director: new Director(base, player.play), player };
  applySettings();
}

function applySettings(): void {
  gsap.globalTimeline.timeScale(settings.timeScale);
  if (!bench) return;
  bench.player.tune.duration = settings.duration;
  bench.player.tune.ease = settings.ease.startsWith('（') ? null : settings.ease;
  bench.scene.lights.sun.intensity = settings.sun;
  bench.scene.lights.hemi.intensity = settings.hemi;
  stage.bloom.intensity = settings.bloomIntensity;
  stage.bloom.mipmapBlurPass.radius = settings.bloomRadius;
}

function play(): void {
  if (!bench) return;
  const events = sampleEvents(settings.kind, bench.director.displayed, settings.fx);
  if (!events) {
    log.textContent = `${settings.kind}：当前棋盘造不出这个事件（比如场上没有随从了），先点"重置棋盘"`;
    return;
  }
  log.textContent = `播放 ${events.map((e) => e.kind).join(' + ')}`;
  bench.director.enqueue(events);
}

build();

const gui = new GUI({ title: '动画调试台 /dev/fx' });
const ev = gui.addFolder('事件');
ev.add(settings, 'kind', [...PRESENTATION_EVENT_KINDS]).name('事件类型');
ev.add(settings, 'fx', ['physical', 'fire', 'frost', 'holy', 'shadow']).name('伤害 fx');
ev.add(settings, 'play').name('播放（P）');
ev.add(settings, 'reset').name('重置棋盘（R）');
const pace = gui.addFolder('节奏');
pace.add(settings, 'timeScale', 0.05, 2, 0.05).name('全局速度（慢放）').onChange(applySettings);
pace.add(settings, 'duration', 0.25, 3, 0.05).name('整步时长倍数').onChange(applySettings);
pace
  .add(settings, 'ease', ['（模块自己的）', 'none', 'power1.out', 'power2.out', 'power3.inOut', 'expo.out', 'sine.inOut', 'back.out(1.7)', 'elastic.out(1,0.45)', 'bounce.out'])
  .name('整步缓动')
  .onChange(applySettings);
const light = gui.addFolder('光照与泛光');
light.add(settings, 'sun', 0, 4, 0.05).name('方向光').onChange(applySettings);
light.add(settings, 'hemi', 0, 3, 0.05).name('半球光').onChange(applySettings);
light.add(settings, 'bloomIntensity', 0, 4, 0.05).name('泛光强度').onChange(applySettings);
light.add(settings, 'bloomRadius', 0, 1, 0.05).name('泛光半径').onChange(applySettings);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') play();
  if (e.code === 'KeyR') build();
});

// 控制台调试入口
(window as unknown as { bench: unknown }).bench = { get current() { return bench; }, stage, settings, play, build, gsap };
