// 事件完整性（spec 6.4、6.7）：每种引擎事件至少一个测试，断言它被发出并且字段齐全。
import { describe, expect, it } from 'vitest';
import { playL0Game } from '../src/ai/selfplay';
import { PRESET_DECKS } from '../src/cards';
import { applyAction, createGame, ENGINE_EVENT_KINDS, type GameEvent } from '../src/engine';
import { EVENT_FIELDS, expectEvent, expectEventShape } from './helpers/events';
import { scenario } from './helpers/scenario';

const decks = (): [string[], string[]] => [[...PRESET_DECKS.demacia!], [...PRESET_DECKS.freljord!]];

describe('事件清单', () => {
  it('字段表覆盖 spec 6.4 的全部 27 种事件', () => {
    expect(Object.keys(EVENT_FIELDS).sort()).toEqual([...ENGINE_EVENT_KINDS].sort());
    expect(ENGINE_EVENT_KINDS).toHaveLength(27);
  });

  it('整局 L0 对局里的每个事件字段都齐全', () => {
    const all: GameEvent[] = [];
    for (const seed of [1, 2, 3]) {
      playL0Game({ seed, classes: ['demacia', 'freljord'], decks: decks(), onEvents: (ev) => all.push(...ev) });
    }
    all.forEach(expectEventShape);
  });
});

describe('每种事件', () => {
  it('mulligan_start、mulligan_done、game_start', () => {
    const created = createGame({ seed: 1, classes: ['demacia', 'freljord'], decks: decks(), first: 0 });
    const start = expectEvent(created.events, 'mulligan_start');
    expect(start.hands[0]).toHaveLength(3);
    expect(start.hands[1]).toHaveLength(5);
    const r1 = applyAction(created.state, { kind: 'mulligan', player: 0, replace: [0] });
    if (!r1.ok) throw new Error(r1.error);
    expect(r1.events).toEqual([]); // 只有一方提交时还不执行
    const r2 = applyAction(r1.state, { kind: 'mulligan', player: 1, replace: [] });
    if (!r2.ok) throw new Error(r2.error);
    const done = r2.events.filter((e) => e.kind === 'mulligan_done');
    expect(done.map((e) => e.kind === 'mulligan_done' && e.side)).toEqual([0, 1]);
    done.forEach(expectEventShape);
    const d0 = expectEvent(r2.events, 'mulligan_done');
    expect(d0.replaced).toHaveLength(1);
    expect(d0.drawn).toHaveLength(1);
    expect(expectEvent(r2.events, 'game_start').first).toBe(0);
  });

  it('turn_start、turn_end、mana_changed、draw', () => {
    const g = scenario().build();
    g.endTurn();
    expect(expectEvent(g.events, 'turn_end')).toMatchObject({ side: 0, turn: 5 });
    expect(expectEvent(g.events, 'turn_start')).toMatchObject({ side: 1, turn: 6 });
    expect(expectEvent(g.events, 'mana_changed')).toMatchObject({ side: 1, reason: 'turn_start' });
    expect(expectEvent(g.events, 'draw')).toMatchObject({ side: 1, handIndex: 0 });
  });

  it('burn', () => {
    const g = scenario().hand(1, Array(10).fill('魔狼')).build();
    g.endTurn();
    expect(expectEvent(g.events, 'burn').side).toBe(1);
  });

  it('fatigue（后面跟着英雄受到的 damage，来源是 fatigue）', () => {
    const g = scenario().deck(1, []).build();
    g.endTurn();
    expect(expectEvent(g.events, 'fatigue')).toMatchObject({ side: 1, amount: 1 });
    expect(expectEvent(g.events, 'damage').source).toEqual({ kind: 'fatigue', side: 1 });
  });

  it('card_played、minion_summoned（via play）', () => {
    const g = scenario().hand(0, ['魔狼']).build();
    g.play('魔狼', { pos: 0 });
    expect(expectEvent(g.events, 'card_played')).toMatchObject({ cardType: 'minion', cost: 2, position: 0, target: null });
    expect(expectEvent(g.events, 'minion_summoned')).toMatchObject({ via: 'play', position: 0, attack: 3, health: 2, source: null, fx: null });
    expect(expectEvent(g.events, 'mana_changed').reason).toBe('play_card');
  });

  it('spell_cast（带 chosen 目标），法术的 card_played 没有位置', () => {
    const g = scenario().hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.hero(1) });
    expect(expectEvent(g.events, 'card_played')).toMatchObject({ cardType: 'spell', position: null, target: g.hero(1) });
    expect(expectEvent(g.events, 'spell_cast').target).toEqual(g.hero(1));
  });

  it('hero_power_used、minion_summoned（via hero_power）', () => {
    const g = scenario().build();
    g.heroPower();
    expect(expectEvent(g.events, 'hero_power_used')).toMatchObject({ side: 0, cardId: 'demacia.hero_power', target: null });
    expect(expectEvent(g.events, 'minion_summoned')).toMatchObject({ via: 'hero_power', fx: 'holy' });
    expect(expectEvent(g.events, 'mana_changed').reason).toBe('hero_power');
  });

  it('minion_summoned（via effect）带来源', () => {
    const g = scenario().hand(0, ['奎因']).build();
    g.play('奎因');
    const summons = g.eventsOf('minion_summoned');
    summons.forEach(expectEventShape);
    expect(summons[1]).toMatchObject({ via: 'effect', cardId: 'token.valor' });
    expect(summons[1].source).toMatchObject({ kind: 'minion', cardId: 'demacia.quinn' });
  });

  it('trigger：战吼带 chosen 目标，在动作事件之前', () => {
    const g = scenario().hand(0, ['拉克丝']).board(1, ['雷克塞']).build();
    g.play('拉克丝', { target: g.m(1, '雷克塞') });
    const t = expectEvent(g.events, 'trigger');
    expect(t).toMatchObject({ timing: 'battlecry', target: g.m(1, '雷克塞'), script: null });
  });

  it('trigger：脚本（泰达米尔）', () => {
    const g = scenario().board(1, ['泰达米尔']).board(0, [{ card: '超级兵', attack: 9 }]).build();
    g.attack(g.m(0, '超级兵'), g.m(1, '泰达米尔'));
    expect(expectEvent(g.events, 'trigger')).toMatchObject({ timing: 'script', script: 'tryndamere_undying' });
  });

  it('attack', () => {
    const g = scenario().board(0, ['魔狼']).build();
    g.attack(g.m(0, '魔狼'), g.hero(1));
    expect(expectEvent(g.events, 'attack')).toMatchObject({ attacker: g.m(0, '魔狼'), target: g.hero(1) });
  });

  it('damage 带前后值', () => {
    const g = scenario().board(1, ['雷克塞']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(1, '雷克塞') });
    expect(expectEvent(g.events, 'damage')).toMatchObject({
      amount: 1,
      shieldAbsorbed: 0,
      healthBefore: 6,
      healthAfter: 5,
      lethalPrevented: false,
      fx: 'fire',
    });
  });

  it('heal 带前后值', () => {
    const g = scenario().health(0, 20).hand(0, ['海洋亚龙']).build();
    g.play('海洋亚龙');
    expect(expectEvent(g.events, 'heal')).toMatchObject({ amount: 4, healthBefore: 20, healthAfter: 24, target: g.hero(0) });
  });

  it('death 带离场前位置', () => {
    const g = scenario().board(1, ['石甲虫', '远程小兵']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(1, '远程小兵') });
    expect(expectEvent(g.events, 'death')).toMatchObject({ position: 1, cardId: 'neutral.caster_minion' });
  });

  it('buff：增益和减益都是它，带前后值', () => {
    const g = scenario().board(1, ['雷克塞']).hand(0, ['特朗德尔']).build();
    g.play('特朗德尔', { target: g.m(1, '雷克塞') });
    const buffs = g.eventsOf('buff');
    buffs.forEach(expectEventShape);
    expect(buffs[0]).toMatchObject({ attack: -2, health: -2, attackBefore: 3, attackAfter: 1, healthBefore: 6, healthAfter: 4, reason: 'effect' });
    expect(buffs[1]).toMatchObject({ attack: 2, health: 2, attackAfter: 5, maxHealthAfter: 7 });
  });

  it('silence', () => {
    const g = scenario().board(1, ['波比']).hand(0, ['卢锡安']).build();
    g.play('卢锡安', { target: g.m(1, '波比') });
    expect(expectEvent(g.events, 'silence').keywordsLost).toEqual(['taunt', 'divine_shield']);
  });

  it('freeze、unfreeze', () => {
    const g = scenario().board(1, ['魔狼']).classes('freljord', 'demacia').build();
    g.heroPower(g.m(1, '魔狼'));
    expect(expectEvent(g.events, 'freeze')).toMatchObject({ frozenAt: 5, fx: 'frost' });
    g.endTurn(); // 轮到魔狼的拥有者，第 6 回合
    g.endTurn(); // 拥有者回合结束，冻结发生在第 5 回合，解冻
    expect(expectEvent(g.events, 'unfreeze')).toMatchObject({ reason: 'turn_end', target: g.m(1, '魔狼') });
  });

  it('shield_broken', () => {
    const g = scenario().board(1, ['波比']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(1, '波比') });
    expect(expectEvent(g.events, 'shield_broken').target).toEqual(g.m(1, '波比'));
    expect(expectEvent(g.events, 'damage')).toMatchObject({ amount: 0, shieldAbsorbed: 1 });
  });

  it('stealth_lost', () => {
    const g = scenario().board(0, ['卡兹克']).build();
    g.attack(g.m(0, '卡兹克'), g.hero(1));
    expect(expectEvent(g.events, 'stealth_lost').target).toEqual(g.m(0, '卡兹克'));
  });

  it('bounce 带回到手牌第几张', () => {
    const g = scenario().board(1, ['魔狼']).hand(0, ['测试回手']).build();
    g.play('测试回手', { target: g.m(1, '魔狼') });
    expect(expectEvent(g.events, 'bounce')).toMatchObject({ handIndex: 0, destroyed: false, position: 0 });
  });

  it('transform 带变成了哪张卡', () => {
    const g = scenario().board(1, ['魔狼']).hand(0, ['璐璐']).build();
    g.play('璐璐', { target: g.m(1, '魔狼') });
    const t = expectEvent(g.events, 'transform');
    expect(t).toMatchObject({ into: 'token.squirrel', cardId: 'neutral.murk_wolf', position: 0, attack: 1, health: 1 });
    expect(t.newTarget).toEqual(g.m(1, '松鼠'));
  });

  it('mana_changed 带前后值和原因', () => {
    const g = scenario().mana(0, 4, 4).hand(0, ['凛冬将至']).build();
    g.play('凛冬将至');
    const changes = g.eventsOf('mana_changed');
    changes.forEach(expectEventShape);
    expect(changes.map((e) => e.reason)).toEqual(['play_card', 'gain_mana']);
    expect(changes[1]).toMatchObject({ before: { max: 4, current: 2, temp: 0 }, after: { max: 5, current: 2, temp: 0 } });
  });

  it('game_over 带胜者', () => {
    const g = scenario().health(1, 2).board(0, ['魔狼']).build();
    g.attack(g.m(0, '魔狼'), g.hero(1));
    expect(expectEvent(g.events, 'game_over').winner).toBe(0);
  });

  it('同一批发生的事件共用一个 group：群体伤害、同时死亡', () => {
    const g = scenario().board(1, ['魔狼', '远程小兵', '石甲虫']).hand(0, ['审判']).build();
    g.play('审判');
    expect(new Set(g.eventsOf('damage').map((e) => e.group)).size).toBe(1);
    expect(new Set(g.eventsOf('death').map((e) => e.group)).size).toBe(1);
    expect(g.eventsOf('damage')[0].group).not.toBe(g.eventsOf('death')[0].group);
  });
});
