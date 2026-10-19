// 招牌卡专属特效（docs/m4-signature-fx.md）：注册表覆盖分镜清单的 11 张；真实引擎事件能命中注册表；
// 导演钩子只把属于招牌特效的事件交给专属模块，其余走默认并推迟到命中帧；同一回合第二张降一档。
import { readFileSync } from 'node:fs';
import gsap from 'gsap';
import { describe, expect, it } from 'vitest';
import { PRESET_DECKS } from '../src/cards';
import { allCards, applyAction, createGame, maskEvents, type GameEvent, type GameState } from '../src/engine';
import { SIGNATURE_CARDS, signatureScenario } from '../src/dev/signatureScenarios';
import type { Anim, AnimContext } from '../src/presentation/animations/types';
import type { PresentationEvent } from '../src/presentation/events';
import { SIGNATURES, signatureIdOf, signatureAnims, spellFxId, TRIGGER_FX, type SignatureTable } from '../src/presentation/signature';
import { claimTurn } from '../src/presentation/signature/kit';
import { composeStep } from '../src/presentation/compose';
import { scenario } from './helpers/scenario';
import type { TableScene } from '../src/scene/table';

const doc = readFileSync(new URL('../docs/m4-signature-fx.md', import.meta.url), 'utf8');
const listed = [...doc.matchAll(/^\|[^|\n]+\|[^|\n]+\|\s*([a-z0-9_]+\.[a-z0-9_]+)\s*\|/gm)].map((m) => m[1]!);

function base(): GameState {
  const s = createGame({ seed: 7, classes: ['ionia', 'noxus'], decks: [[...PRESET_DECKS.ionia!], [...PRESET_DECKS.noxus!]] }).state;
  s.phase = 'playing';
  s.turn = 9;
  s.current = 0;
  for (const p of s.players) p.mulliganDone = true;
  return s;
}

function run(fxId: string, foes = 3): PresentationEvent[] {
  const setup = signatureScenario(fxId, base(), foes);
  let state = setup.state;
  const out: PresentationEvent[] = [];
  for (const a of setup.actions) {
    const r = applyAction(state, a);
    if (!r.ok) throw new Error(`${fxId}: ${r.error}`);
    state = r.state;
    out.push(...maskEvents(r.events, 0));
  }
  return out;
}

// 按 group 分步（导演一批里相邻、同 group 的事件合成一步）
function steps(events: PresentationEvent[]): PresentationEvent[][] {
  const out: PresentationEvent[][] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last[0]!.group === e.group) last.push(e);
    else out.push([e]);
  }
  return out;
}

const fakeScene = (turn = 1) => ({ view: { turn } }) as unknown as TableScene;
const ctxOf = (scene: TableScene) => (i: number) => ({ scene, viewer: 0, index: i }) as unknown as AnimContext;
const anim = (seconds: number, extra: Partial<Anim> = {}): Anim => ({ tl: gsap.timeline().to({}, { duration: seconds }), ...extra });

describe('注册表', () => {
  it('分镜清单的 11 个 fxId 都注册了，没有多出来的', () => {
    expect(listed).toHaveLength(11);
    expect(Object.keys(SIGNATURES).sort()).toEqual([...listed].sort());
    expect(SIGNATURE_CARDS.map((c) => c.fxId).sort()).toEqual([...listed].sort());
  });

  it('卡池里写了 fxId 的动作，fxId 全都注册了；泰达米尔、易按 (卡牌 id, 触发时机) 映射', () => {
    const ids = new Set<string>();
    for (const c of allCards()) for (const eff of c.effects ?? []) if (eff.trigger !== 'static') for (const a of eff.actions) if ('fxId' in a && a.fxId && !a.fxId.startsWith('test.')) ids.add(a.fxId);
    expect(ids.size).toBe(9);
    for (const id of ids) expect(SIGNATURES[id], id).toBeTypeOf('function');
    expect(Object.values(TRIGGER_FX).sort()).toEqual(['masteryi.highlander', 'tryndamere.undying_rage']);
    expect(spellFxId('ionia.last_breath')).toBe('yasuo.last_breath');
    expect(spellFxId('demacia.demacian_justice')).toBe('garen.demacian_justice');
    expect(spellFxId('freljord.glacial_fissure')).toBeNull();
    expect(spellFxId('hidden')).toBeNull();
  });
});

describe('真实引擎事件命中注册表', () => {
  it.each(SIGNATURE_CARDS.map((c) => [c.name, c.fxId] as const))('%s（%s）', (_name, fxId) => {
    const events = run(fxId);
    const hits = events.filter((e) => signatureIdOf(e, SIGNATURES) === fxId);
    expect(hits.length, fxId).toBeGreaterThan(0);
    // 命中的事件之外，没有别的事件被误认成其他招牌特效
    for (const e of events) expect([null, fxId]).toContain(signatureIdOf(e, SIGNATURES));
  });

  it('招牌法术：spell_cast 那一步和伤害那一步都命中，死亡那一步走默认', () => {
    const ss = steps(run('yasuo.last_breath'));
    const kinds = ss.map((s) => [s[0]!.kind, s.every((e) => signatureIdOf(e, SIGNATURES) !== null)]);
    expect(kinds).toContainEqual(['spell_cast', true]);
    expect(kinds).toContainEqual(['damage', true]);
    expect(kinds).toContainEqual(['death', false]);
  });

  it('暴风雪：伤害和冻结两组都命中；德玛西亚正义：消灭挂在 death 上', () => {
    const ss = steps(run('anivia.glacial_storm'));
    expect(ss.filter((s) => s.some((e) => signatureIdOf(e, SIGNATURES) === 'anivia.glacial_storm')).map((s) => s[0]!.kind)).toEqual(['spell_cast', 'damage', 'freeze']);
    const dj = run('garen.demacian_justice').filter((e) => e.kind === 'death');
    expect(dj).toHaveLength(1);
    expect(signatureIdOf(dj[0]!, SIGNATURES)).toBe('garen.demacian_justice');
  });

  it('泰达米尔的触发和致命伤害在同一步（攻击那一步），易的触发单独一步', () => {
    const tr = steps(run('tryndamere.undying_rage')).find((s) => s.some((e) => e.kind === 'trigger'))!;
    expect(tr.map((e) => e.kind)).toContain('attack');
    expect(tr.some((e) => e.kind === 'damage' && e.lethalPrevented)).toBe(true);
    const yi = steps(run('masteryi.highlander')).find((s) => s.some((e) => signatureIdOf(e, SIGNATURES) === 'masteryi.highlander'))!;
    expect(yi.map((e) => e.kind)).toEqual(['trigger']);
  });

  it('没注册的卡照常走默认：普通群体法术、普通攻击、战吼都不命中', () => {
    // 借招牌卡的局面（敌方有随从），换成普通的群体伤害、群体冻结
    for (const card of ['noxus.decimate', 'freljord.glacial_fissure']) {
      const { state } = signatureScenario('yasuo.last_breath', base(), 3);
      state.players[0].hand = [{ instanceId: state.nextInstanceId++, cardId: card }];
      const r = applyAction(state, { kind: 'play_card', handIndex: 0 });
      expect(r.ok, card).toBe(true);
      if (!r.ok) continue;
      expect(r.events.some((e) => e.kind === 'damage' || e.kind === 'freeze')).toBe(true);
      for (const e of r.events as GameEvent[]) expect(signatureIdOf(e, SIGNATURES), `${card} ${e.kind}`).toBeNull();
    }
  });

  it('暴风雪打满 7 个随从：伤害、冻结各 7 个，全部命中', () => {
    const events = run('anivia.glacial_storm', 7);
    expect(events.filter((e) => e.kind === 'damage' && signatureIdOf(e, SIGNATURES))).toHaveLength(7);
    expect(events.filter((e) => e.kind === 'freeze' && signatureIdOf(e, SIGNATURES))).toHaveLength(7);
  });
});

describe('导演钩子', () => {
  const ev = (kind: string, extra: object = {}) => ({ kind, group: 1, ...extra }) as unknown as PresentationEvent;
  const dmg = (fxId?: string) => ev('damage', fxId ? { fxId, target: { side: 1, kind: 'minion', instanceId: 1 } } : { target: { side: 1, kind: 'minion', instanceId: 2 } });

  it('这一步没有招牌特效时返回 null（整步走默认）', () => {
    const table: SignatureTable = { 'a.b': () => anim(1) };
    expect(signatureAnims([dmg(), ev('shield_broken')], ctxOf(fakeScene()), () => anim(0.4), table)).toBeNull();
    // 数据里写了 fxId、但没注册的也走默认
    expect(signatureAnims([dmg('x.y')], ctxOf(fakeScene()), () => anim(0.4), table)).toBeNull();
  });

  it('同一个 fxId 的事件交给专属模块一次；其余走默认，推迟到专属模块报的命中帧，cue 跟着挪', () => {
    const calls: number[] = [];
    const table: SignatureTable = {
      'a.b': (c) => {
        calls.push(c.events.length);
        expect(c.ctxs.map((x) => x.index)).toEqual([0, 2]);
        return { ...anim(1.2), hitAt: 0.5 };
      },
    };
    const defaults: string[] = [];
    const out = signatureAnims(
      [dmg('a.b'), ev('shield_broken'), dmg('a.b')],
      ctxOf(fakeScene()),
      (e) => {
        defaults.push(e.kind);
        return anim(0.25, { cues: [{ channel: 'impact:shield', at: 0.1, weight: 1, run: () => {} }] });
      },
      table,
    )!;
    expect(calls).toEqual([2]);
    expect(defaults).toEqual(['shield_broken']);
    expect(out).toHaveLength(2);
    const shield = out[1]!;
    expect(shield.tl.duration()).toBeCloseTo(0.75);
    expect(shield.cues![0]!.at).toBeCloseTo(0.6);
    expect('hitAt' in out[0]!).toBe(false);
  });

  it('专属模块可以拿默认动画来用（byDefault 按它自己的事件序号）', () => {
    const seen: string[] = [];
    const table: SignatureTable = { 'a.b': (c) => (c.byDefault(1), anim(1)) };
    signatureAnims([ev('spell_cast', { card: { instanceId: 1, cardId: 'hidden' } }), dmg('a.b'), dmg('a.b')], ctxOf(fakeScene()), (e, i) => (seen.push(`${e.kind}@${i}`), anim(0.1)), table);
    // 专属模块要的是它自己第 1 个事件（整步第 2 个）的默认动画；spell_cast（遮住的牌）不是招牌特效，照常走默认
    expect(seen.sort()).toEqual(['damage@2', 'spell_cast@0']);
  });
});

describe('分量', () => {
  it('同一回合里第二张招牌卡降一档，换回合后恢复', () => {
    const s = fakeScene(3);
    expect(claimTurn(s)).toBe(0);
    expect(claimTurn(s)).toBe(1);
    expect(claimTurn(s)).toBe(1);
    (s as unknown as { view: { turn: number } }).view.turn = 4;
    expect(claimTurn(s)).toBe(0);
  });
});

describe('易的演出和 E14 同时开始（死亡那一步报 readyAt）', () => {
  // 按导演的分步把一批真实引擎事件逐步喂给钩子，返回每一步的 [事件种类, 合成后下一组的开始时刻]
  const table: SignatureTable = { 'masteryi.highlander': () => anim(0.6) };
  function play(events: readonly GameEvent[]): { kinds: string; ready: number; early: boolean }[] {
    const scene = fakeScene(5);
    const before = { players: [{ board: [] }, { board: [] }] };
    const ctx = (i: number) => ({ scene, viewer: 0, index: i, before }) as unknown as AnimContext;
    return steps([...events]).map((st) => {
      const anims = signatureAnims(st, ctx, () => anim(0.7, { tail: 0.27 }), table);
      const master = composeStep(anims ?? st.map(() => anim(0.7, { tail: 0.27 })));
      const ready = (master.data as { ready: number }).ready;
      return { kinds: [...new Set(st.map((e) => e.kind))].join('+'), ready, early: (anims ?? []).some((a) => a.readyAt === 0) };
    });
  }
  const deathStep = (r: ReturnType<typeof play>) => r.find((x) => x.kinds === 'death')!;

  it('易攻击打死随从：死亡那一步从 0 秒就放下一组，下一组正是易的 on_kill', () => {
    const g = scenario().board(0, ['易']).board(1, [{ card: '近战小兵', health: 1 }]).build();
    g.attack(g.m(0, '易'), g.m(1, '近战小兵'));
    const r = play(g.events);
    expect(r.map((x) => x.kinds)).toEqual(['attack+damage', 'death', 'trigger']);
    expect(deathStep(r).early).toBe(true);
    expect(deathStep(r).ready).toBe(0);
  });

  it('易被攻击、反击打死对方，剧毒打死，也同时开始', () => {
    const g = scenario().board(0, ['近战小兵']).board(1, [{ card: '易', health: 5 }]).build();
    g.attack(g.m(0, '近战小兵'), g.m(1, '易'));
    expect(deathStep(play(g.events)).early).toBe(true);
    const p = scenario().board(0, [{ card: '易', health: 9, maxHealth: 9, keywords: ['poisonous'] }]).board(1, [{ card: '石甲虫', health: 9 }]).build();
    p.attack(p.m(0, '易'), p.m(1, '石甲虫'));
    const r = play(p.events);
    expect(r.map((x) => x.kinds)).toEqual(['attack+damage', 'death', 'trigger']);
    expect(deathStep(r).early).toBe(true);
  });

  it('不提前：易也死了（引擎不发 on_kill）、被打死的有亡语（亡语排在前面）、不是易打死的', () => {
    const both = scenario().board(0, ['易']).board(1, [{ card: '近战小兵', attack: 5, health: 1 }]).build();
    both.attack(both.m(0, '易'), both.m(1, '近战小兵'));
    const rb = play(both.events);
    expect(rb.map((x) => x.kinds)).toEqual(['attack+damage', 'death']);
    expect(deathStep(rb).early).toBe(false);

    const rattle = scenario().board(0, [{ card: '易', health: 9, maxHealth: 9 }]).board(1, ['艾尼维亚']).build();
    rattle.attack(rattle.m(0, '易'), rattle.m(1, '艾尼维亚'));
    const rr = play(rattle.events);
    expect(rr[2]!.kinds).toBe('trigger'); // 亡语
    expect(deathStep(rr).early).toBe(false);
    expect(deathStep(rr).ready).toBeGreaterThan(0);

    const other = scenario().board(0, ['魔狼']).board(1, [{ card: '近战小兵', health: 1 }]).build();
    other.attack(other.m(0, '魔狼'), other.m(1, '近战小兵'));
    expect(deathStep(play(other.events)).early).toBe(false);
  });

  it('易的伤害和死亡之间隔了别的步，不提前', () => {
    const g = scenario().board(0, ['易']).board(1, [{ card: '近战小兵', health: 1 }]).build();
    g.attack(g.m(0, '易'), g.m(1, '近战小兵'));
    const ev = [...g.events];
    const i = ev.findIndex((e) => e.kind === 'death');
    ev.splice(i, 0, { kind: 'mana_changed', group: 99, side: 0, before: { max: 1, current: 1, temp: 0 }, after: { max: 1, current: 1, temp: 0 }, reason: 'gain_mana' });
    expect(deathStep(play(ev)).early).toBe(false);
  });
});
