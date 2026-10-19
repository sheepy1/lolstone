// 动画调试台 /dev/fx（spec 6.1、6.2，只进开发构建）：在一块固定的中盘棋盘上单独触发任意一种事件的动画，
// 慢放、改整步时长和缓动曲线、调光照和泛光；GSDevTools 接在最近一步的时间线上，可以拖时间轴。
// 棋盘也可以直接玩：手牌能拖、随从能攻击（只有我方，没有对手 AI），用来调拿起手感（DRAG）和出随从砸落（PLAY_MINION）。
// 播过样例事件后显示局面和真实局面不一致，要先"重置棋盘"才能再拖牌。
// M4 在这里逐条打磨动画：试出满意的时长和曲线后写回 src/presentation/animations 里对应的模块。
import gsap from 'gsap';
import { GSDevTools } from 'gsap/GSDevTools';
import GUI from 'lil-gui';
import { l0ChooseAction } from '../../ai/l0';
import { installDefaultPool, PRESET_DECKS } from '../../cards';
import { applyAction, createGame, getCard, listLegalActions, maskEvents, seedRng, type Action, type Fx, type GameState, type RngState, type Side } from '../../engine';
import { PLAY_MINION } from '../../presentation/animations/minionSummoned';
import { ATTACK, BUFF, DEATH, FREEZE, HEAL, HERO_HIT, HIT, SHIELD, STEALTH } from '../../presentation/animations/combat';
import { FLOAT_TEXT } from '../../presentation/fx/combatText';
import { CRACKS } from '../../presentation/fx/nexusCracks';
import { SCREEN } from '../../presentation/fx/screen';
import { COMBAT_SCENARIOS, combatEvents, fullBoard, fullBoardWipe, type CombatScenario } from '../combatScenarios';
import { measureFrames, recordFrames } from '../recorder';
import type { PresentationEvent } from '../../presentation/events';
import { DRAG, Interaction } from '../../scene/interaction';
import { END_TURN } from '../../scene/endTurnButton';
import { NEXUS_LAMP } from '../../scene/nexusLamps';
import { Director } from '../../presentation/director';
import { PRESENTATION_EVENT_KINDS, type PresentationEventKind } from '../../presentation/events';
import { createGsapPlayer, type GsapPlayer } from '../../presentation/player';
import { viewFromState, type ViewState } from '../../presentation/viewState';
import { Stage } from '../../scene/stage';
import { TableScene } from '../../scene/table';
import { AI_THINK } from '../../presentation/animations/aiThinking';
import { BURN } from '../../presentation/animations/burn';
import { FATIGUE } from '../../presentation/animations/fatigue';
import { ENDGAME } from '../../presentation/animations/gameOver';
import { MULLIGAN } from '../../presentation/animations/mulliganDone';
import { OPENING } from '../../presentation/animations/mulliganStart';
import { TURN_END } from '../../presentation/animations/turnEnd';
import { FLOW } from '../../presentation/fx/flow';
import { MANA_FX } from '../../scene/tableParts';
import { AI_PACE } from '../../app/match';
import { SAMPLE, sampleEvents } from '../sampleEvents';
import { addSpellPanel } from '../spellPanel';
import { DEV_SPELL_CARDS } from '../spellScenarios';

gsap.registerPlugin(GSDevTools);
installDefaultPool(DEV_SPELL_CARDS);

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

const baseState: GameState = benchState();
const base: ViewState = viewFromState(baseState, 0);
const stage = new Stage(document.getElementById('stage')!);
const log = document.getElementById('log')!;

type Bench = { scene: TableScene; director: Director; player: GsapPlayer; interaction: Interaction; state: GameState; dirty: boolean };
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
  combat: COMBAT_SCENARIOS[0] as CombatScenario,
  amount: 3,
  playCombat: () => playCombat(),
  fullBoard: () => build(fullBoard(base, BOARD_CARDS)),
  wipe: () => playEvents(fullBoardWipe(bench!.director.displayed)),
};

// 满场压力测试用的随从：两套预组里的随从牌
const BOARD_CARDS = [...new Set([...PRESET_DECKS.ionia!, ...PRESET_DECKS.noxus!])].filter((id) => getCard(id).type === 'minion');

function build(view: ViewState = base): void {
  if (bench) {
    for (const t of gsap.globalTimeline.getChildren(false, true, true)) t.kill();
    bench.interaction.destroy();
    bench.scene.dispose();
  }
  const scene = new TableScene(view, stage);
  const player = createGsapPlayer(scene);
  player.resetSpeed = () => {}; // 慢放由调试台控制，队列播空时不改回 1 倍
  player.onTimeline = (tl) => {
    devtools?.kill();
    devtools = GSDevTools.create({ animation: tl, container: document.body, minimal: false, persist: false });
  };
  const director = new Director(view, player.play);
  // 改过场面的棋盘（满场压力测试）和真实局面对不上，不接受拖牌
  const b: Bench = { scene, director, player, interaction: null as never, state: baseState, dirty: view !== base };
  const legal = (): Action[] | null => (director.busy || b.dirty || b.state.current !== 0 ? null : listLegalActions(b.state, 0));
  b.interaction = new Interaction(scene, {
    legal,
    submit: (a) => {
      const r = applyAction(b.state, a);
      if (!r.ok) return;
      b.state = r.state;
      director.enqueue(maskEvents(r.events, 0));
    },
    busy: () => director.busy,
    fastForward: () => {},
    hover: () => {},
    mulliganChanged: () => {},
    waiting: () => false,
  });
  director.subscribe(() => b.interaction.refresh());
  b.interaction.refresh();
  bench = b;
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
  playEvents(events);
}

function playEvents(events: PresentationEvent[]): void {
  if (!bench) return;
  log.textContent = `播放 ${events.map((e) => e.kind).join(' + ')}（之后先"重置棋盘"再拖牌）`;
  bench.dirty = true;
  bench.interaction.refresh();
  bench.director.enqueue(events);
}

function playCombat(): boolean {
  if (!bench) return false;
  const events = combatEvents(settings.combat, bench.director.displayed, settings.amount);
  if (!events) {
    log.textContent = `${settings.combat}：当前棋盘造不出这个场景（比如需要的随从已经死了或没有圣盾），先点"重置棋盘"`;
    return false;
  }
  playEvents(events);
  return true;
}

// 录一个战斗场景的逐帧画面：先重置棋盘，原速和 slow 倍慢放各录一份。返回帧数
async function recordCombat(scenario: CombatScenario, name: string, opts: { amount?: number; slow?: number; everyNth?: number; view?: ViewState; events?: () => PresentationEvent[] } = {}) {
  build(opts.view ?? base);
  settings.combat = scenario;
  settings.amount = opts.amount ?? settings.amount;
  gsap.globalTimeline.timeScale(1);
  // 先把场景渲染稳定（头像贴图、SDF 字体在第一帧之后才就位）
  for (let i = 0; i < 3; i++) stage.frame(1 / 60);
  await new Promise((r) => setTimeout(r, 400));
  let started = false;
  const r = await recordFrames({
    stage,
    name,
    slow: opts.slow ?? 1,
    everyNth: opts.everyNth ?? 1,
    start: () => {
      started = opts.events ? (playEvents(opts.events()), true) : playCombat();
    },
    done: () => !started || !bench!.director.busy,
    tail: 0.5,
    maxSeconds: 8,
  });
  gsap.globalTimeline.timeScale(settings.timeScale);
  return r;
}

// 量一个场景的每帧耗时（固定步长推进，渲染后读回像素等 GPU）
async function benchCombat(view: ViewState | null, events: () => PresentationEvent[], seconds = 6) {
  build(view ?? base);
  for (let i = 0; i < 3; i++) stage.frame(1 / 60);
  await new Promise((r) => setTimeout(r, 400));
  return measureFrames({
    stage,
    start: () => playEvents(events()),
    // 固定跑满 seconds，空场基准和带事件的可以直接比
    done: () => false,
    maxSeconds: seconds,
  });
}

build();

const gui = new GUI({ title: '动画调试台 /dev/fx' });
const ev = gui.addFolder('事件');
ev.add(settings, 'kind', [...PRESENTATION_EVENT_KINDS]).name('事件类型');
ev.add(settings, 'fx', ['physical', 'fire', 'frost', 'holy', 'shadow']).name('伤害 fx');
ev.add(settings, 'play').name('播放（P）');
ev.add(settings, 'reset').name('重置棋盘（R）');
const combat = gui.addFolder('战斗事件（m4-storyboard E11 到 E19、E24）');
combat.add(settings, 'combat', [...COMBAT_SCENARIOS]).name('场景');
combat.add(settings, 'amount', 0, 10, 1).name('伤害 / 治疗 / 增益量');
combat.add(settings, 'playCombat').name('播放场景（C）');
combat.add(settings, 'fullBoard').name('满场 14 个随从');
combat.add(settings, 'wipe').name('满场同时受伤加死亡');
type Params = { [k: string]: number | Params | number[] };
const tune = (title: string, obj: Params, ranges: Record<string, [number, number, number]> = {}, parent: GUI = combat) => {
  const f = parent.addFolder(title);
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'object' && !Array.isArray(v)) {
      tune(k, v, ranges, f);
      continue;
    }
    if (typeof v !== 'number') continue;
    const [lo, hi, step] = ranges[k] ?? (Number.isInteger(v) && v >= 1 ? [0, Math.max(10, v * 3), 1] : [0, Math.max(1, v * 3), 0.005]);
    f.add(obj, k, lo, hi, step);
  }
  f.close();
};
tune('攻击 ATTACK', ATTACK, { windupTilt: [0, 40, 1], dashTilt: [-40, 20, 1] });
tune('受伤 HIT', HIT);
tune('英雄受伤 HERO_HIT', HERO_HIT);
tune('死亡 DEATH', DEATH);
tune('治疗 HEAL', HEAL);
tune('圣盾 SHIELD', SHIELD);
tune('冻结 FREEZE', FREEZE);
tune('潜行 STEALTH', STEALTH);
tune('增益减益 BUFF', BUFF);
tune('飘字 FLOAT_TEXT', FLOAT_TEXT as unknown as Params);
tune('裂纹 CRACKS', CRACKS as unknown as Params);
tune('画面反馈 SCREEN', SCREEN as unknown as Params);
combat.close();
addSpellPanel(gui, { stage, baseState, build, playEvents, busy: () => !!bench?.director.busy, log: (s) => (log.textContent = s) });
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

const drag = gui.addFolder('拿起手感 DRAG');
drag.add(DRAG, 'frequency', 1, 15, 0.5).name('弹簧频率 Hz');
drag.add(DRAG, 'damping', 0.2, 1.5, 0.05).name('阻尼比');
drag.add(DRAG, 'maxLag', 0, 1, 0.05).name('最多落后（卡宽）');
drag.add(DRAG, 'tiltPerSpeed', 0, 15, 0.5).name('倾斜（度/卡宽每秒）');
drag.add(DRAG, 'maxTilt', 0, 40, 1).name('倾角上限（度）');
drag.add(DRAG, 'roll', 0, 1.5, 0.05).name('翻滚比例');
drag.add(DRAG, 'lift', 0, 1, 0.05).name('拿起高度（卡高）');
drag.add(DRAG, 'pickScale', 0.8, 1.4, 0.01).name('拿起放大');
drag.add(DRAG, 'rowScale', 0.3, 1, 0.01).name('随从行上缩到');
drag.add(DRAG, 'returnTime', 0.1, 1, 0.05).name('取消回手时长');
const slam = gui.addFolder('出随从砸落 PLAY_MINION');
slam.add(PLAY_MINION, 'hover', 0.4, 3, 0.05).name('悬停高度');
slam.add(PLAY_MINION, 'charge', 0, 0.4, 0.01).name('蓄力时长');
slam.add(PLAY_MINION, 'chargeLift', 0, 0.6, 0.01).name('蓄力上抬');
slam.add(PLAY_MINION, 'smash', 0.04, 0.4, 0.01).name('砸落时长');
slam.add(PLAY_MINION, 'squashY', 0.5, 1, 0.01).name('压扁高度');
slam.add(PLAY_MINION, 'squashX', 1, 1.4, 0.01).name('压扁宽度');
slam.add(PLAY_MINION, 'settle', 0.1, 0.8, 0.01).name('回弹时长');
slam.add(PLAY_MINION, 'shockwaveCost', 0, 10, 1).name('冲击波费用');
slam.add(PLAY_MINION, 'shakeCost', 0, 10, 1).name('震屏费用');
const look = gui.addFolder('枢纽方案（切换会重新加载）');
const nexus = { style: new URLSearchParams(location.search).get('nexus') ?? 'b' };
look.add(nexus, 'style', ['a', 'b', 'c']).name('方案').onChange((v: string) => {
  const q = new URLSearchParams(location.search);
  q.set('nexus', v);
  location.search = q.toString();
});

// 回合流程（m4-storyboard E01 到 E05、E25 到 E29）：事件在上面"事件"里选，这里调时长
const flow = gui.addFolder('回合流程');
flow.close();
flow.add(SAMPLE, 'winner', ['我方胜', '我方负', '平局']).name('game_over 结果');
const addAll = (folder: GUI, obj: Record<string, unknown>, prefix: string) => {
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'number') folder.add(obj, k, 0, Math.max(2, v * 3), 0.01).name(`${prefix} ${k}`);
};
addAll(flow, OPENING, 'E01');
addAll(flow, MULLIGAN, '换牌');
addAll(flow, FLOW, 'E02/E03');
addAll(flow, TURN_END, 'E26');
addAll(flow, MANA_FX, 'E25');
addAll(flow, BURN, 'E04');
addAll(flow, FATIGUE, 'E05');
addAll(flow, AI_THINK, 'E27');
addAll(flow, AI_PACE, 'E27 思考');
addAll(flow, ENDGAME, 'E28/29');

// 方案 b 的小灯。"谁的回合""生命"只改画面，不改局面，"重置棋盘"后恢复
const lamp = gui.addFolder('枢纽小灯 NEXUS_LAMP');
lamp.add(NEXUS_LAMP, 'core', 0.5, 6, 0.1).name('灯芯亮度');
lamp.add(NEXUS_LAMP, 'active', 0, 2, 0.05).name('自己回合');
lamp.add(NEXUS_LAMP, 'idle', 0, 2, 0.05).name('对方回合');
lamp.add(NEXUS_LAMP, 'period', 0.5, 6, 0.1).name('呼吸周期');
lamp.add(NEXUS_LAMP, 'breath', 0, 0.6, 0.01).name('呼吸幅度');
lamp.add(NEXUS_LAMP, 'fade', 0.05, 2, 0.05).name('换回合过渡');
lamp.add(NEXUS_LAMP, 'lowPeriod', 0.1, 2, 0.05).name('危险闪烁周期');
lamp.add(NEXUS_LAMP, 'lowBreath', 0, 1, 0.01).name('危险闪烁幅度');
lamp.add(NEXUS_LAMP, 'glass', 0, 2, 0.05).name('玻璃反射');
lamp.add(NEXUS_LAMP, 'rimGlass', 0, 1, 0.01).name('玻璃边缘白光');
lamp.add(NEXUS_LAMP, 'rimGlow', 0, 2, 0.05).name('玻璃边缘透色');
const lampView = { turn: '我方', health: 30 };
const applyLampView = () => {
  if (!bench) return;
  const me = bench.director.displayed.viewer;
  for (const side of [0, 1] as Side[]) {
    const h = bench.scene.heroes[side];
    h.setActive((lampView.turn === '我方') === (side === me));
    h.setHealth(lampView.health, 30);
  }
};
lamp.add(lampView, 'turn', ['我方', '对方']).name('谁的回合').onChange(applyLampView);
lamp.add(lampView, 'health', 0, 30, 1).name('双方生命').onChange(applyLampView);

// 结束回合按钮。"状态"只改画面（下一次局面同步会改回来），用来看四种状态和翻面动画
const endTurn = gui.addFolder('结束回合按钮 END_TURN');
endTurn.add(END_TURN, 'tilt', 0, 1.2, 0.01).name('面板倾角');
endTurn.add(END_TURN, 'glow', 0, 4, 0.05).name('发光边亮度');
endTurn.add(END_TURN, 'face', 0, 1, 0.01).name('面板自发光');
endTurn.add(END_TURN, 'pulse', 0.4, 5, 0.05).name('脉动周期');
endTurn.add(END_TURN, 'pulseAmp', 0, 0.8, 0.01).name('脉动幅度');
endTurn.add(END_TURN, 'readyGlow', 0, 5, 0.05).name('该点了亮度');
endTurn.add(END_TURN, 'readyPulse', 0.2, 3, 0.05).name('该点了脉动周期');
endTurn.add(END_TURN, 'flip', 0.05, 1, 0.01).name('翻面时长');
const endTurnView = { state: '我方回合' };
endTurn
  .add(endTurnView, 'state', ['我方回合', '该点了', '对方回合', '熄灭'])
  .name('状态')
  .onChange((v: string) => {
    const b = bench?.scene.endTurn;
    if (!b) return;
    b.setMode(v === '对方回合' ? 'theirs' : v === '熄灭' ? 'off' : 'mine', v === '该点了');
  });
endTurn.add({ press: () => bench?.scene.endTurn.press() }, 'press').name('按一下');

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') play();
  if (e.code === 'KeyR') build();
  if (e.code === 'KeyC') playCombat();
});

// 控制台调试入口
(window as unknown as { bench: unknown }).bench = {
  get current() {
    return bench;
  },
  stage, settings, play, build, gsap, base, playEvents, playCombat, recordCombat, benchCombat,
  fullBoard: () => fullBoard(base, BOARD_CARDS),
  fullBoardWipe,
  scenarios: COMBAT_SCENARIOS,
};
