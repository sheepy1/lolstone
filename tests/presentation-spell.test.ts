// 法术和英雄技能演出的时间表（m4-storyboard E06、E09、E10、E23）：打到谁、按哪种 fx、命中帧在哪一秒，
// 以及导演是不是正好在命中帧开始下一组（伤害、冻结、召唤）。画面在 /dev/fx 里录帧验收，这里只测不依赖画面的规则。
import gsap from 'gsap';
import { describe, expect, it } from 'vitest';
import { allCards, type TargetRef } from '../src/engine';
import { HIT } from '../src/presentation/animations/combat';
import { composeStep, placeStarts, type Placed } from '../src/presentation/compose';
import {
  effectHit,
  HERO_POWER,
  heroPowerDuration,
  heroPowerHit,
  hitTimes,
  planSpell,
  SPELL,
  spellSfx,
  stepEnd,
  tailFor,
} from '../src/presentation/fx/spellPlan';
import type { ViewState } from '../src/presentation/viewState';

const seg = (d: number) => gsap.timeline().to({}, { duration: d });
const minion = (side: 0 | 1, instanceId: number): TargetRef => ({ side, kind: 'minion', instanceId });

// planSpell 只读两边场上随从的实例 id
function view(mine: number[], theirs: number[]): ViewState {
  const p = (ids: number[]) => ({ board: ids.map((instanceId) => ({ instanceId })) });
  return { players: [p(mine), p(theirs)] } as unknown as ViewState;
}
const V = view([1, 2], [11, 12, 13]);

// 这一步合成后导演在哪一秒开始下一组
function readyOf(end: number, at: number): number {
  const master = composeStep([{ tl: seg(end), tail: tailFor(end, at) }]);
  return (master.data as { ready: number }).ready;
}

describe('法术打到谁、按哪种 fx（E09、E10）', () => {
  it('单体：目标是选中的那个，按第一个带 fx 的动作', () => {
    const t = minion(1, 12);
    const p = planSpell('noxus.might_of_noxus', 0, t, V);
    expect(p).toMatchObject({ fx: 'fire', shape: 'single', harmful: true, targets: [t], amount: 4 });
    expect(p.hit).toBeCloseTo(SPELL.dissolve + SPELL.fire.travel);
    expect(spellSfx(p)).toBe('spell.fire');
  });

  it('群体：敌方全体随从，大法术音', () => {
    const p = planSpell('noxus.decimate', 0, null, V);
    expect(p.shape).toBe('group');
    expect(p.targets).toEqual([minion(1, 11), minion(1, 12), minion(1, 13)]);
    expect(spellSfx(p)).toBe('spell.big');
    // 对手施放时打的是我方
    expect(planSpell('noxus.decimate', 1, null, V).targets).toEqual([minion(0, 1), minion(0, 2)]);
  });

  it('有益的法术不算有害（不炸、不震、不闪棋盘）', () => {
    expect(planSpell('demacia.light_shield', 0, minion(0, 1), V).harmful).toBe(false);
    expect(planSpell('demacia.rally', 0, null, V)).toMatchObject({ shape: 'group', harmful: false, targets: [minion(0, 1), minion(0, 2)] });
    expect(planSpell('ionia.recall', 0, minion(0, 1), V).harmful).toBe(false);
  });

  it('后面接群体冻结时标出来：冻结那组自己闪冰色棋盘，法术不再闪', () => {
    expect(planSpell('freljord.blizzard', 0, null, V).freezesAll).toBe(true);
    expect(planSpell('freljord.glacial_fissure', 0, null, V).freezesAll).toBe(true);
    expect(planSpell('freljord.crystal_arrow', 0, minion(1, 11), V).freezesAll).toBe(false);
  });

  it('无目标法术：抽牌飞向牌库、加法力飞向法力条，fx 按职业', () => {
    expect(planSpell('ionia.meditate', 0, null, V)).toMatchObject({ shape: 'none', noTarget: 'draw', fx: 'shadow', targets: [] });
    expect(planSpell('freljord.hawkshot', 0, null, V)).toMatchObject({ noTarget: 'draw', fx: 'frost' });
    expect(planSpell('freljord.winters_approach', 0, null, V)).toMatchObject({ noTarget: 'mana', fx: 'frost' });
    expect(planSpell('token.mana_potion', 0, null, V)).toMatchObject({ noTarget: 'mana', fx: 'holy' });
  });

  it('群体法术打空场：按无目标处理，不抛错', () => {
    expect(planSpell('noxus.decimate', 0, null, view([], [])).targets).toEqual([]);
  });

  it('卡池里每张法术都排得出时间表，fx 是五种之一', () => {
    for (const c of allCards().filter((x) => x.type === 'spell')) {
      const p = planSpell(c.id, 0, minion(1, 11), V);
      expect(['fire', 'frost', 'holy', 'shadow', 'physical']).toContain(p.fx);
      expect(p.hit).toBeGreaterThan(SPELL.dissolve);
    }
  });
});

describe('展示段时长（E06、E09）', () => {
  it('自己出的法术展示缩到 300ms，对手出牌 800ms（飞入 250、停 450、溶解退场 100）', () => {
    expect(SPELL.mine.fly + SPELL.mine.hold).toBeCloseTo(0.3);
    expect(SPELL.theirs.fly + SPELL.theirs.hold + SPELL.dissolve).toBeCloseTo(0.8);
    expect(SPELL.theirs.flip).toBe(0.4);
  });

  it('效果段按分镜：火 250、冰 300、光落地在 300 以内、影 250 + 100、物理 200 的中点', () => {
    expect(effectHit('fire')).toBeCloseTo(0.25);
    expect(effectHit('frost')).toBeCloseTo(0.3);
    expect(effectHit('holy')).toBeLessThan(SPELL.holy.pillar);
    expect(effectHit('shadow')).toBeCloseTo(0.35);
    expect(effectHit('physical')).toBeCloseTo(0.07);
  });
});

describe('命中帧接下一组（分镜 1.7、E09"效果的命中帧接 damage"）', () => {
  it('每种 fx 的单体：导演正好在命中帧开始下一组', () => {
    for (const fx of ['fire', 'frost', 'holy', 'shadow', 'physical'] as const) {
      const hit = SPELL.dissolve + effectHit(fx);
      const end = stepEnd(hit, SPELL.residual);
      expect(readyOf(end, hit)).toBeCloseTo(hit, 5);
    }
  });

  it('群体法术 1 到 7 个目标：下一组在第一个命中帧开始，后面的目标和同组伤害的错开一一对上', () => {
    expect(SPELL.stagger).toBe(HIT.stagger);
    for (let n = 1; n <= 7; n++) {
      const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 1.95);
      const plan = { hit: SPELL.dissolve + effectHit('physical') };
      const hits = hitTimes(plan, xs);
      const end = stepEnd(plan.hit, Math.max(...hits) - plan.hit + SPELL.residual);
      const ready = readyOf(end, plan.hit);
      expect(ready).toBeCloseTo(plan.hit, 5);
      // 下一组的伤害按 compose 的规则错开，从 ready 起算，正好落在每个目标的命中帧
      const damage: Placed[] = xs.map((x) => ({ tl: seg(0.4), order: x, stagger: HIT.stagger }));
      placeStarts(damage).forEach((s, i) => expect(ready + s).toBeCloseTo(hits[i], 5));
    }
  });

  it('同一个横坐标算同一格，乱序也按从左到右排', () => {
    hitTimes({ hit: 0.2 }, [3, -1, 3, 0]).forEach((h, i) => expect(h).toBeCloseTo([0.28, 0.2, 0.28, 0.24][i], 9));
  });

  it('时间线最长是命中帧 / 0.6：tail 不会被整步时长截掉', () => {
    expect(stepEnd(0.17, 0.5)).toBeCloseTo(0.17 / 0.6);
    expect(stepEnd(0.35, 0.1)).toBeCloseTo(0.45);
  });
});

describe('英雄技能（E23）', () => {
  it('按下 200（起 80 + 弹 120）、出手 300、冷却 100，共 600ms', () => {
    expect(HERO_POWER.pressDown + HERO_POWER.pressUp).toBeCloseTo(0.2);
    expect(HERO_POWER.cast).toBeCloseTo(0.3);
    expect(heroPowerDuration()).toBeCloseTo(0.6);
    expect(HERO_POWER.pressScale).toBe(0.92);
  });

  it('命中帧按职业：断头台 250、灵魄 250、寒冰箭 220，召集是光柱落地；都在出手段以内', () => {
    expect(heroPowerHit('noxus')).toBeCloseTo(0.45);
    expect(heroPowerHit('ionia')).toBeCloseTo(0.45);
    expect(heroPowerHit('freljord')).toBeCloseTo(0.42);
    for (const cls of ['demacia', 'noxus', 'ionia', 'freljord'] as const) {
      const hit = heroPowerHit(cls);
      expect(hit).toBeLessThanOrEqual(0.2 + HERO_POWER.cast);
      const end = stepEnd(hit, heroPowerDuration() - hit);
      expect(readyOf(end, hit)).toBeCloseTo(hit, 5);
    }
  });
});
