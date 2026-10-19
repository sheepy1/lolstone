// 调试台的"法术和英雄技能"面板（m4-storyboard E06、E09、E10、E23）：选一个场景和施法方，用真的引擎事件播一遍；
// 参数对象 SPELL、HERO_POWER 可以现场调。控制台 spellBench.record(场景, 名字, { side, slow }) 录逐帧画面到
// .dev-output/rec/<名字>/，同时把这段里的音效和时刻写进返回值（静音下也能核对声音落在哪一帧）。
import type GUI from 'lil-gui';
import { sfxLog } from '../audio';
import type { GameState, Side } from '../engine';
import type { PresentationEvent } from '../presentation/events';
import { HERO_POWER, SPELL } from '../presentation/fx/spellPlan';
import type { ViewState } from '../presentation/viewState';
import type { Stage } from '../scene/stage';
import { recordFrames } from './recorder';
import { prepareSpell, SPELL_CASE_NAMES, spellEvents, type SpellCaseName } from './spellScenarios';

type Deps = {
  stage: Stage;
  baseState: GameState;
  build: (view: ViewState) => void;
  playEvents: (events: PresentationEvent[]) => void;
  busy: () => boolean;
  log: (s: string) => void;
};

export function addSpellPanel(gui: GUI, d: Deps): void {
  const st = { name: SPELL_CASE_NAMES[0] as SpellCaseName, side: '我方' as '我方' | '对手', play: () => void play() };
  const sideOf = (): Side => (st.side === '我方' ? 0 : 1);

  // 每次都从中盘局面重新开始：换职业、加牌之后重建场景
  function start(name: SpellCaseName, side: Side): boolean {
    const prep = prepareSpell(d.baseState, name, side);
    if (!prep) {
      d.log(`${name}：这个局面打不出来`);
      return false;
    }
    d.build(prep.view);
    const events = spellEvents(prep.state, prep.action);
    if (!events) return false;
    d.playEvents(events);
    return true;
  }

  async function play(): Promise<void> {
    start(st.name, sideOf());
  }

  async function record(name: SpellCaseName, out: string, opts: { side?: Side; slow?: number; everyNth?: number; quality?: number } = {}) {
    const side = opts.side ?? 0;
    const prep = prepareSpell(d.baseState, name, side);
    if (!prep) return null;
    d.build(prep.view);
    for (let i = 0; i < 3; i++) d.stage.frame(1 / 60);
    await new Promise((r) => setTimeout(r, 400));
    const sounds: [string, number][] = [];
    sfxLog.splice(0);
    let started = false;
    const r = await recordFrames({
      stage: d.stage,
      name: out,
      slow: opts.slow ?? 1,
      everyNth: opts.everyNth ?? 1,
      quality: opts.quality,
      start: () => {
        const events = spellEvents(prep.state, prep.action);
        if (events) d.playEvents(events);
        started = true;
      },
      onFrame: (_i, t) => {
        while (sfxLog.length > 0) sounds.push([sfxLog.shift()!, Math.round(t * 1000)]);
      },
      done: () => started && !d.busy(),
      tail: 0.4,
      maxSeconds: 5,
    });
    return { ...r, sounds };
  }

  const f = gui.addFolder('法术和英雄技能（E06、E09、E10、E23）');
  f.add(st, 'name', SPELL_CASE_NAMES).name('场景');
  f.add(st, 'side', ['我方', '对手']).name('施法方');
  f.add(st, 'play').name('播放（S）');
  const tune = (title: string, obj: Record<string, unknown>) => {
    const g = f.addFolder(title);
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') g.add(obj, k, 0, Math.max(1, v * 3), 0.005);
      else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'number') g.add(v as Record<string, number>, k2, 0, Math.max(1, v2 * 3), 0.005).name(`${k}.${k2}`);
    }
    g.close();
  };
  tune('法术 SPELL', SPELL as unknown as Record<string, unknown>);
  tune('英雄技能 HERO_POWER', HERO_POWER as unknown as Record<string, unknown>);
  f.close();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyS') void play();
  });
  (window as unknown as { spellBench: unknown }).spellBench = { record, start, cases: SPELL_CASE_NAMES };
}
