// 战斗事件的表现层约定（m4-storyboard 1.4、1.7 和 E11 到 E19、E24）：同组错开成波、每步只留一次的反馈、
// 震屏的频率限制、各事件的阶段时长和分镜一致。动画本身要 WebGL，在 /dev/fx 里录帧验收，这里只测不依赖画面的规则。
import gsap from 'gsap';
import { describe, expect, it } from 'vitest';
import { ATTACK, DEATH, FREEZE, HERO_HIT, HIT } from '../src/presentation/animations/combat';
import { composeStep, pickCues, placeStarts, startTimes, type Placed } from '../src/presentation/compose';
import { tierOf } from '../src/presentation/fx/combatText';
import { allowShake } from '../src/presentation/fx/screen';
import type { TableScene } from '../src/scene/table';

const seg = (d: number) => gsap.timeline().to({}, { duration: d });

describe('同组并行（分镜 1.7）', () => {
  it('没有攻击时按目标横坐标从左到右每个错开 stagger', () => {
    const anims: Placed[] = [
      { tl: seg(0.4), order: 3, stagger: 0.04 },
      { tl: seg(0.4), order: -2, stagger: 0.04 },
      { tl: seg(0.4), order: 0, stagger: 0.04 },
    ];
    expect(placeStarts(anims)).toEqual([0.08, 0, 0.04]);
    expect(startTimes(composeStep(anims)).sort()).toEqual([0, 0.04, 0.08]);
  });

  it('同一个目标上的两个事件（伤害加冻结）落在同一格', () => {
    const anims: Placed[] = [
      { tl: seg(0.4), order: 1, stagger: 0.04 },
      { tl: seg(0.5), order: 1, stagger: 0.04 },
      { tl: seg(0.4), order: 5, stagger: 0.04 },
    ];
    expect(placeStarts(anims)).toEqual([0, 0, 0.04]);
  });

  it('有攻击的一步不错开：攻击方和被攻击方同一个命中帧', () => {
    const anims: Placed[] = [
      { tl: seg(0.6), impact: 0.33 },
      { tl: seg(0.4), order: 2, stagger: 0.04 },
      { tl: seg(0.4), order: -2, stagger: 0.04 },
    ];
    expect(placeStarts(anims)).toEqual([0, 0.33, 0.33]);
  });

  it('一组只有一个目标时不错开', () => {
    expect(placeStarts([{ tl: seg(0.4), order: 2, stagger: 0.05 }])).toEqual([0]);
  });
});

describe('每步只留一次的反馈（分镜 1.4、1.6、1.7）', () => {
  const noop = () => {};
  it('震屏取最重的一次，放在这一频道最早的时刻', () => {
    const heavy = () => {};
    const anims: Placed[] = [
      { tl: seg(0.4), cues: [{ channel: 'shake', at: 0, weight: 1, run: noop }] },
      { tl: seg(0.4), cues: [{ channel: 'shake', at: 0, weight: 2, run: heavy }] },
    ];
    const picked = pickCues(anims, [0, 0.08]);
    expect(picked).toHaveLength(1);
    expect(picked[0].run).toBe(heavy);
    expect(picked[0].time).toBe(0);
  });

  it('语音只播最后一个（死亡语音播最后死的那个）', () => {
    const last = () => {};
    const anims: Placed[] = [
      { tl: seg(0.7), cues: [{ channel: 'voice', at: 0.2, weight: 1, run: noop }] },
      { tl: seg(0.7), cues: [{ channel: 'voice', at: 0.2, weight: 1, run: last }] },
      { tl: seg(0.7), cues: [{ channel: 'voice', at: 0.2, weight: 1, run: noop }] },
    ];
    const picked = pickCues(anims, [0.05, 0.1, 0]);
    expect(picked[0].run).toBe(last);
    expect(picked[0].time).toBeCloseTo(0.3);
  });

  it('同一频道多于一条且带 many 时改调 many（群体增益的大金环、群体冻结的棋盘闪）', () => {
    const one = () => {};
    const many = () => {};
    const cue = { channel: 'buff_ring', at: 0, weight: 1, run: one, many };
    expect(pickCues([{ tl: seg(0.4), cues: [cue] }], [0])[0].run).toBe(one);
    expect(pickCues([{ tl: seg(0.4), cues: [cue] }, { tl: seg(0.4), cues: [cue] }], [0, 0.04])[0].run).toBe(many);
  });

  it('不同频道互不影响，cue 进了合成的时间线但不算在事件的开始时刻里', () => {
    const calls: string[] = [];
    const master = composeStep([
      { tl: seg(0.4), cues: [{ channel: 'impact:hit', at: 0, weight: 3, run: () => calls.push('hit') }] },
      { tl: seg(0.4), cues: [{ channel: 'impact:shield', at: 0, weight: 1, run: () => calls.push('shield') }] },
    ]);
    expect(startTimes(master)).toEqual([0, 0]);
    master.progress(1);
    expect(calls.sort()).toEqual(['hit', 'shield']);
  });
});

describe('震屏频率限制（分镜 1.4）', () => {
  const fakeScene = (turn: number) => ({ view: { turn } }) as unknown as TableScene;

  it('S2 以上每回合最多 3 次，超出的降一档', () => {
    const scene = fakeScene(5);
    expect(allowShake(scene, 2, 0)).toBe(2);
    expect(allowShake(scene, 3, 2)).toBe(3);
    expect(allowShake(scene, 2, 4)).toBe(2);
    expect(allowShake(scene, 2, 6)).toBe(1);
    expect(allowShake(scene, 3, 8)).toBe(1); // 3 降到 2 仍超额，再降到 1
  });

  it('同一秒内不重复', () => {
    const scene = fakeScene(1);
    expect(allowShake(scene, 2, 10)).toBe(2);
    expect(allowShake(scene, 2, 10.5)).toBe(1);
    expect(allowShake(scene, 2, 11.2)).toBe(2);
  });

  it('换回合重新计数；S1 不受限', () => {
    const scene = { view: { turn: 1 } } as unknown as TableScene;
    for (let i = 0; i < 3; i++) allowShake(scene, 2, i * 2);
    expect(allowShake(scene, 2, 10)).toBe(1);
    (scene as unknown as { view: { turn: number } }).view.turn = 2;
    expect(allowShake(scene, 2, 12)).toBe(2);
    for (let i = 0; i < 10; i++) expect(allowShake(scene, 1, 20 + i * 0.1)).toBe(1);
  });
});

describe('阶段时长和分镜一致', () => {
  it('E11 攻击：蓄力 150 + 冲锋 180 = 命中帧 330，回位 270，共 600', () => {
    expect(ATTACK.windup + ATTACK.dash).toBeCloseTo(0.33);
    expect(ATTACK.windup + ATTACK.dash + ATTACK.recover).toBeCloseTo(0.6);
  });

  it('E14 死亡：定格 80 + 碎裂 350 + 合拢 270 = 700，合拢从碎裂的 250ms 开始', () => {
    expect(DEATH.freeze + DEATH.shatter + DEATH.close).toBeCloseTo(0.7);
    expect(DEATH.closeAt).toBeCloseTo(0.25);
    expect(DEATH.stagger).toBeCloseTo(0.05);
  });

  it('E17 冻结：扩散 200 + 覆冰 300 = 500，解冻冰层 150', () => {
    expect(FREEZE.spread + FREEZE.coat).toBeCloseTo(0.5);
    expect(FREEZE.thaw).toBeCloseTo(0.15);
  });

  it('E12、E24：命中声 ≥ 3 换重、≥ 5 叠低频，英雄 3 到 4 S1、≥ 5 S2；同组错开 40ms', () => {
    expect(HIT.heavyAt).toBe(3);
    expect(HIT.lowAt).toBe(5);
    expect(HERO_HIT.midAt).toBe(3);
    expect(HERO_HIT.heavyAt).toBe(5);
    expect(HIT.stagger).toBeCloseTo(0.04);
  });

  it('飘字字号三档：≤ 2 小、3 到 4 中、≥ 5 大', () => {
    expect([1, 2, 3, 4, 5, 9].map(tierOf)).toEqual(['small', 'small', 'mid', 'mid', 'big', 'big']);
  });
});
