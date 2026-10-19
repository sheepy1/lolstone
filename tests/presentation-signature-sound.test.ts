// 招牌演出的声音：同一个音效键不在 300ms 内响两次（起手那一步和主步各放一次同一个音效，听起来是"啪啪"两下）。
// 做法：每张卡用真实引擎的事件，按导演的分步逐步交给钩子和 compose，手动推 GSAP 时钟，记下每个 playSfx 的键和时刻。
// 场景是一个只够跑时间线的假对象（没有随从物件，画面的部分大多跳过，声音照常放）；默认模块用只带声音 cue 的替身
// （受伤的命中声、死亡的碎裂声，和 damage.ts、death.ts 报的一样），这样"专属模块自己放的"和"默认的 cue"会一起核对。
import gsap from 'gsap';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const played: { id: string; t: number }[] = [];
vi.mock('../src/audio', async (orig) => {
  const real = await orig<typeof import('../src/audio')>();
  return { ...real, playSfx: (id: string) => played.push({ id, t: gsap.globalTimeline.time() }), playVoice: () => {} };
});
// 霜纹贴图要 canvas，测试环境没有 DOM
vi.mock('../src/presentation/fx/iceShell', async (orig) => ({ ...(await orig<object>()), frostRing: () => gsap.timeline() }));

import { PRESET_DECKS } from '../src/cards';
import { applyAction, createGame, maskEvents, type GameState } from '../src/engine';
import { SIGNATURE_CARDS, signatureScenario } from '../src/dev/signatureScenarios';
import { hitCue } from '../src/presentation/animations/combat';
import type { Anim, AnimContext } from '../src/presentation/animations/types';
import { composeStep } from '../src/presentation/compose';
import type { PresentationEvent } from '../src/presentation/events';
import { SIGNATURES, signatureAnims } from '../src/presentation/signature';
import { reduceView, viewFromState, type ViewState } from '../src/presentation/viewState';
import type { TableScene } from '../src/scene/table';

// 分镜里写明了要连着响几次的（节奏本身就是演出），只有这些允许 300ms 内重复
const RHYTHM: Record<string, string[]> = {
  'yasuo.last_breath': ['combat.swing'], // action 连斩 whoosh 三声
  'katarina.death_lotus': ['combat.swing'], // action 旋转 whoosh 持续
  'garen.judgment': ['combat.swing'], // action 旋扫 whoosh 两圈
  'lissandra.frozen_tomb': ['combat.freeze'], // impact 每个冰棺合上一声轻
};

function base(): GameState {
  const s = createGame({ seed: 7, classes: ['ionia', 'noxus'], decks: [[...PRESET_DECKS.ionia!], [...PRESET_DECKS.noxus!]] }).state;
  s.phase = 'playing';
  s.turn = 9;
  s.current = 0;
  for (const p of s.players) p.mulliganDone = true;
  return s;
}

function fakeScene(view: ViewState): TableScene {
  const s = {
    view,
    layers: { fx: new THREE.Group(), top: new THREE.Group() },
    lights: { hemi: { intensity: 0.85 }, sun: { intensity: 1.9 } },
    stage: { onFrame: () => () => {}, reflections: null, camera: new THREE.PerspectiveCamera(), cameraShake: new THREE.Vector3(), cameraTarget: new THREE.Vector3(), look: { brightness: 0 } },
    particles: { emit: () => ({ kill() {}, stop() {}, timeScale() {} }) },
    heldSpawns: new Set<number>(),
    handSpawn: new Map<number, unknown>(),
    pendingPlayCards: new Map<number, unknown>(),
    minion: () => undefined,
    pointOf: () => ({ x: 0, y: 0.35, z: -2 }),
    place: (side: number) => (side === view.viewer ? 'near' : 'far'),
    sync: () => false,
    heroes: [],
  };
  return s as unknown as TableScene;
}

// 默认模块的替身：只报声音的 cue（和 damage.ts、death.ts 一样的频道和音效）
function stub(e: PresentationEvent): Anim {
  const tl = gsap.timeline().to({}, { duration: 0.4 });
  if (e.kind === 'damage' && e.amount > 0) return { tl, cues: [hitCue(0, e.amount, () => 0, e.target.kind === 'hero')] };
  if (e.kind === 'death') return { tl, cues: [{ channel: 'impact:death', at: 0.08, weight: 1, run: () => played.push({ id: 'combat.death', t: gsap.globalTimeline.time() }) }] };
  return { tl };
}

const tick = gsap.ticker;
let T = 0;
const wake = tick.wake;
beforeAll(() => {
  tick.sleep();
  (tick as unknown as { wake: () => void }).wake = () => {};
  T = gsap.globalTimeline.time();
});
afterAll(() => {
  (tick as unknown as { wake: typeof wake }).wake = wake;
});
function advance(seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * 120); i++) gsap.updateRoot((T += 1 / 120));
}

// 一张卡从出牌到播完，返回这期间放过的音效（时刻相对开始）
function soundsOf(fxId: string, foes = 4): { id: string; t: number }[] {
  const setup = signatureScenario(fxId, base(), foes);
  let state = setup.state;
  const events: PresentationEvent[] = [];
  for (const a of setup.actions) {
    const r = applyAction(state, a);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
    events.push(...maskEvents(r.events, 0));
  }
  let view = viewFromState(setup.state, 0);
  const scene = fakeScene(view);
  played.length = 0;
  const t0 = gsap.globalTimeline.time();
  const steps: PresentationEvent[][] = [];
  for (const e of events) {
    const last = steps[steps.length - 1];
    if (last && last[0]!.group === e.group) last.push(e);
    else steps.push([e]);
  }
  for (const st of steps) {
    const before = view;
    const after: ViewState[] = [];
    for (const e of st) after.push((view = reduceView(view, e)));
    (scene as unknown as { view: ViewState }).view = after[after.length - 1]!;
    const ctxOf = (i: number) => ({ scene, before: i === 0 ? before : after[i - 1], after: after[i], viewer: 0, step: st, index: i }) as unknown as AnimContext;
    const anims = signatureAnims(st, ctxOf, (e) => stub(e), SIGNATURES) ?? st.map(stub);
    const master = composeStep(anims);
    gsap.globalTimeline.add(master, gsap.globalTimeline.time());
    master.play(0);
    const ready = (master.data as { ready?: number }).ready ?? master.duration();
    advance(Math.max(ready, 0.01));
  }
  advance(2);
  return played.map((p) => ({ id: p.id, t: p.t - t0 }));
}

describe('招牌演出的声音', () => {
  it.each(SIGNATURE_CARDS.map((c) => [c.name, c.fxId] as const))('%s（%s）：同一个音效键 300ms 内不重复', (_n, fxId) => {
    const sounds = soundsOf(fxId);
    expect(sounds.length, `${fxId} 一个音效都没放`).toBeGreaterThan(0);
    const allowed = RHYTHM[fxId] ?? [];
    const byId = new Map<string, number[]>();
    for (const s of sounds) byId.set(s.id, [...(byId.get(s.id) ?? []), s.t]);
    for (const [id, ts] of byId) {
      if (allowed.includes(id)) continue;
      ts.sort((a, b) => a - b);
      for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!, `${fxId}：${id} 在 ${ts[i - 1]!.toFixed(3)}s 和 ${ts[i]!.toFixed(3)}s 各响一次`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('暴风雪的冰霜施法音只响一次（起手那一步），风雪的 magic 层是 spell.big', () => {
    const sounds = soundsOf('anivia.glacial_storm');
    expect(sounds.filter((s) => s.id === 'spell.frost')).toHaveLength(1);
    expect(sounds.filter((s) => s.id === 'spell.big')).toHaveLength(1);
  });

  it('德玛西亚正义的天光音只响一次', () => {
    expect(soundsOf('garen.demacian_justice').filter((s) => s.id === 'spell.holy')).toHaveLength(1);
  });
});
