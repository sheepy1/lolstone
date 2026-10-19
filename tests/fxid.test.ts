// fxId 透传（spec 3.4）：引擎不读 fxId，原样放进事件；动作没写 fxId 时事件里没有这个键。
import { describe, expect, it } from 'vitest';
import { CARD_POOL, HERO_CLASSES, validateCardPool } from '../src/cards';
import type { CardDef, GameEvent } from '../src/engine';
import { expectEventShape } from './helpers/events';
import { scenario } from './helpers/scenario';

const allHaveFxId = (events: GameEvent[], id: string) =>
  expect(events.every((e) => (e as { fxId?: string }).fxId === id)).toBe(true);

describe('fxId 透传：测试专用卡', () => {
  it('伤害、治疗、增益、冻结、沉默事件都带 fxId，字段齐全，JSON 往返不变', () => {
    const g = scenario().board(1, [{ card: '魔狼', health: 5 }]).hand(0, ['测试特效组合']).build();
    g.play('测试特效组合', { target: g.m(1, '魔狼') });
    for (const kind of ['damage', 'heal', 'buff', 'freeze', 'silence'] as const) {
      const es = g.eventsOf(kind);
      expect(es, kind).toHaveLength(1);
      expect(es[0].fxId, kind).toBe('test.spark');
      expectEventShape(es[0]);
    }
    expect(g.eventsOf('damage')[0].fx).toBe('fire');
    expect(JSON.parse(JSON.stringify(g.events))).toEqual(g.events);
    expect(JSON.parse(JSON.stringify(g.state))).toEqual(g.state);
  });

  it('回手、变形、召唤事件带 fxId', () => {
    const g = scenario().board(1, ['魔狼']).hand(0, ['测试特效回手', '测试特效变形', '测试特效召唤']).build();
    g.play('测试特效回手', { target: g.m(1, '魔狼') });
    expect(g.eventsOf('bounce')[0].fxId).toBe('test.spark');
    expectEventShape(g.eventsOf('bounce')[0]);

    const g2 = scenario().board(1, ['魔狼']).hand(0, ['测试特效变形']).build();
    g2.play('测试特效变形', { target: g2.m(1, '魔狼') });
    expect(g2.eventsOf('transform')[0].fxId).toBe('test.spark');
    expectEventShape(g2.eventsOf('transform')[0]);

    const g3 = scenario().hand(0, ['测试特效召唤']).build();
    g3.play('测试特效召唤');
    expect(g3.eventsOf('minion_summoned')[0].fxId).toBe('test.spark');
    expectEventShape(g3.eventsOf('minion_summoned')[0]);
  });

  it('消灭不发事件，fxId 和 fx 挂在被消灭随从的 death 事件上', () => {
    const g = scenario().board(1, ['魔狼', '近战小兵']).hand(0, ['测试特效消灭']).build();
    g.play('测试特效消灭', { target: g.m(1, '魔狼') });
    const deaths = g.eventsOf('death');
    expect(deaths).toHaveLength(1);
    expect(deaths[0]).toMatchObject({ fx: 'physical', fxId: 'test.spark' });
    expectEventShape(deaths[0]);
  });

  it('没有 fxId 的卡，事件里没有 fxId 这个键（不是 null，也不是 undefined）', () => {
    const g = scenario().board(1, ['魔狼']).hand(0, ['测试飞弹', '测试回手']).build();
    g.play('测试飞弹', { target: g.m(1, '魔狼') });
    g.play('测试回手', { target: g.m(1, '魔狼') });
    expect(g.log.length).toBeGreaterThan(0);
    for (const e of g.log) {
      expect('fxId' in e, e.kind).toBe(false);
      expectEventShape(e);
    }
    // 没带 fxId 的消灭，death 事件也没有 fx、fxId
    const g2 = scenario().board(1, [{ card: '魔狼', health: 1, maxHealth: 2 }]).hand(0, ['测试处决']).build();
    g2.play('测试处决', { target: g2.m(1, '魔狼') });
    expect(g2.eventsOf('death')).toHaveLength(1);
    for (const e of g2.log) expect('fxId' in e || (e.kind === 'death' && 'fx' in e)).toBe(false);
  });

  it('引擎自己产生的事件（攻击伤害、激怒、到期）没有 fxId', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['近战小兵']).build();
    g.attack(g.m(0, '魔狼'), g.m(1, '近战小兵'));
    for (const e of g.log) expect('fxId' in e).toBe(false);
  });
});

describe('fxId 透传：9 张数据驱动的招牌卡', () => {
  it('狂风绝息斩：damage', () => {
    const g = scenario().board(1, ['魔狼', '石甲虫']).hand(0, ['狂风绝息斩']).build();
    g.play('狂风绝息斩');
    const es = g.eventsOf('damage');
    expect(es).toHaveLength(2);
    allHaveFxId(es, 'yasuo.last_breath');
    expect(es[0].fx).toBe('physical');
  });

  it('暴风雪：damage 和 freeze', () => {
    const g = scenario().board(1, ['雷克塞', '魔狼']).hand(0, ['暴风雪']).build();
    g.play('暴风雪');
    allHaveFxId(g.eventsOf('damage'), 'anivia.glacial_storm');
    allHaveFxId(g.eventsOf('freeze'), 'anivia.glacial_storm');
    expect(g.eventsOf('freeze').length).toBeGreaterThan(0);
    expect(g.eventsOf('freeze')[0].fx).toBe('frost');
  });

  it('丽桑卓：battlecry 的 freeze', () => {
    const g = scenario().board(1, ['魔狼', '卡兹克']).hand(0, ['丽桑卓']).build();
    g.play('丽桑卓');
    const es = g.eventsOf('freeze');
    expect(es).toHaveLength(2);
    allHaveFxId(es, 'lissandra.frozen_tomb');
  });

  it('卡特琳娜：battlecry 的 damage', () => {
    const g = scenario().board(1, ['魔狼', '石甲虫']).hand(0, ['卡特琳娜']).build();
    g.play('卡特琳娜');
    const es = g.eventsOf('damage');
    expect(es).toHaveLength(2);
    allHaveFxId(es, 'katarina.death_lotus');
  });

  it('审判：damage', () => {
    const g = scenario().board(1, ['魔狼', '石甲虫']).hand(0, ['审判']).build();
    g.play('审判');
    const es = g.eventsOf('damage');
    expect(es).toHaveLength(2);
    allHaveFxId(es, 'garen.judgment');
  });

  it('德玛西亚正义：消灭不发事件，fxId 在 death 上', () => {
    const g = scenario().board(1, ['泰达米尔']).hand(0, ['德玛西亚正义']).build();
    g.play('德玛西亚正义', { target: g.m(1, '泰达米尔') });
    const es = g.eventsOf('death');
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ fx: 'holy', fxId: 'garen.demacian_justice' });
  });

  it('劫：battlecry 的 summon', () => {
    const g = scenario().hand(0, ['劫']).build();
    g.play('劫');
    const summoned = g.eventsOf('minion_summoned');
    // 劫自己是打出（没有 fxId），影分身是效果召唤
    expect(summoned).toHaveLength(2);
    expect('fxId' in summoned[0]).toBe(false);
    expect(summoned[1].fxId).toBe('zed.living_shadow');
    expect(summoned[1].fx).toBe('shadow');
  });

  it('李青：combo 的 bounce', () => {
    const g = scenario().board(1, ['雷克塞']).hand(0, ['飞斧', '李青']).build();
    g.play('飞斧', { target: g.hero(1) });
    g.play('李青', { target: g.m(1, '雷克塞') });
    const es = g.eventsOf('bounce');
    expect(es).toHaveLength(1);
    expect(es[0].fxId).toBe('leesin.dragons_rage');
  });

  it('纳什男爵：turn_end 的 buff', () => {
    const g = scenario().board(0, ['纳什男爵', '近战小兵']).build();
    g.endTurn();
    const es = g.eventsOf('buff').filter((e) => e.reason === 'effect');
    expect(es).toHaveLength(1);
    expect(es[0].fxId).toBe('baron.hand_of_baron');
  });

  it('泰达米尔和易不改数据：卡牌里没有 fxId，事件里也没有', () => {
    const g = scenario().board(0, ['泰达米尔']).board(1, ['魔狼']).build();
    g.endTurn();
    g.attack(g.m(1, '魔狼'), g.m(0, '泰达米尔'));
    for (const id of ['freljord.tryndamere', 'ionia.masteryi']) {
      const def = CARD_POOL.find((c) => c.id === id)!;
      expect(JSON.stringify(def)).not.toContain('fxId');
    }
    for (const e of g.log) expect('fxId' in e).toBe(false);
  });

  it('卡池里带 fxId 的动作正好是这 9 张卡', () => {
    const ids = CARD_POOL.filter((c) => JSON.stringify(c.effects ?? []).includes('"fxId"')).map((c) => c.id).sort();
    expect(ids).toEqual([
      'demacia.demacian_justice', 'demacia.judgment', 'freljord.blizzard', 'freljord.lissandra', 'ionia.last_breath',
      'ionia.leesin', 'ionia.zed', 'neutral.baron_nashor', 'noxus.katarina',
    ]);
  });
});

describe('fxId 校验（spec 3.4 命名规则）', () => {
  const spellWith = (fxId: unknown): CardDef => ({
    id: 'neutral.bad_spell', name: '坏法术', type: 'spell', class: 'neutral', cost: 1, text: '',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 1, target: 'enemy_hero', fx: 'fire', fxId: fxId as string }] }],
  });
  const errors = (fxId: unknown) => validateCardPool([...structuredClone([...CARD_POOL]), spellWith(fxId)], HERO_CLASSES);

  it('合法的 fxId 通过', () => {
    expect(errors('anivia.glacial_storm')).toEqual([]);
    expect(errors('zed.living_shadow2')).toEqual([]);
  });

  it('大写、空格、连字符、缺点、多余的点、空串、非字符串都报错', () => {
    for (const bad of ['Anivia.glacial_storm', 'anivia.glacial storm', 'anivia.glacial-storm', 'anivia', 'a.b.c', '.x', 'x.', '', 42, null]) {
      expect(errors(bad).join(), String(bad)).toMatch(/bad fxId/);
    }
  });

  it('没有 fx 的动作不能带 fxId', () => {
    const card: CardDef = {
      id: 'neutral.bad_spell', name: '坏法术', type: 'spell', class: 'neutral', cost: 1, text: '',
      effects: [{ trigger: 'cast', actions: [{ kind: 'draw', count: 1, fxId: 'a.b' } as never] }],
    };
    expect(validateCardPool([...structuredClone([...CARD_POOL]), card], HERO_CLASSES).join()).toMatch(/fxId only allowed/);
  });
});
