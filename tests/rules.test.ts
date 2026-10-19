// 对局规则（spec 2.3–2.13）和效果模型（spec 3.4）里关键词以外的部分。
import { describe, expect, it } from 'vitest';
import { expectIllegal, scenario } from './helpers/scenario';

describe('回合流程（2.3）', () => {
  it('回合开始：法力上限 +1、回满，触发回合开始效果，再抽牌', () => {
    const g = scenario().mana(1, 0, 3).board(1, ['测试回合开始']).build();
    g.endTurn();
    const p = g.p(1);
    expect(p.mana).toEqual({ max: 4, current: 4, temp: 0 });
    const kinds = g.kinds();
    expect(kinds.indexOf('turn_end')).toBeLessThan(kinds.indexOf('turn_start'));
    expect(kinds.indexOf('turn_start')).toBeLessThan(kinds.indexOf('mana_changed'));
    expect(kinds.indexOf('trigger')).toBeLessThan(kinds.indexOf('draw'));
    expect(g.state.turn).toBe(6);
    expect(g.state.current).toBe(1);
  });

  it('法力上限最多 10', () => {
    const g = scenario().mana(1, 10, 10).build();
    g.endTurn();
    expect(g.p(1).mana.max).toBe(10);
  });

  it('回合结束："本回合"的临时增益消失', () => {
    const g = scenario().board(0, ['魔狼']).hand(0, ['测试血怒']).build();
    g.play('测试血怒', { target: g.m(0, '魔狼') });
    expect(g.minion(0, '魔狼').attack).toBe(6);
    expect(g.minion(0, '魔狼').keywords).toContain('stealth');
    g.endTurn();
    expect(g.minion(0, '魔狼').attack).toBe(3);
    expect(g.minion(0, '魔狼').keywords).not.toContain('stealth');
    const expire = g.eventsOf('buff').find((e) => e.reason === 'expire')!;
    expect(expire.attack).toBe(-3);
    expect(expire.keywordsLost).toEqual(['stealth']);
  });

  it('临时增益到期时不移除卡面本来就有的关键词', () => {
    const g = scenario().board(0, ['卡兹克']).hand(0, ['测试血怒']).build();
    g.play('测试血怒', { target: g.m(0, '卡兹克') });
    g.endTurn();
    expect(g.minion(0, '卡兹克').keywords).toContain('stealth');
  });

  it('非当前玩家不能结束回合，换牌阶段之外不能换牌', () => {
    const g = scenario().build();
    expect(g.legal(1)).toEqual([]);
    expectIllegal(g.try({ kind: 'mulligan', player: 0, replace: [] }));
  });
});

describe('出牌（2.4）', () => {
  it('支付费用；费用不够不能出', () => {
    const g = scenario().mana(0, 3).hand(0, ['魔狼', '雷克塞']).build();
    expect(g.legal().some((a) => a.kind === 'play_card' && a.handIndex === 1)).toBe(false);
    expectIllegal(g.try(g.playAction('雷克塞')));
    g.play('魔狼');
    expect(g.p(0).mana.current).toBe(1);
  });

  it('随从放在玩家选的位置', () => {
    const g = scenario().board(0, ['近战小兵', '远程小兵']).hand(0, ['魔狼']).build();
    g.play('魔狼', { pos: 1 });
    expect(g.boardNames(0)).toEqual(['近战小兵', '魔狼', '远程小兵']);
    expect(g.eventsOf('minion_summoned')[0]).toMatchObject({ position: 1, via: 'play' });
  });

  it('场上已有 7 个随从时不能出随从', () => {
    const g = scenario().board(0, Array(7).fill('近战小兵')).hand(0, ['魔狼']).build();
    expect(g.legal().some((a) => a.kind === 'play_card')).toBe(false);
    expectIllegal(g.try(g.playAction('魔狼', { pos: 0 })));
  });

  it('位置超出范围、法术带位置、手牌下标不存在都是非法动作', () => {
    const g = scenario().hand(0, ['魔狼', '集结']).build();
    expectIllegal(g.try({ kind: 'play_card', handIndex: 0, position: 5 }));
    expectIllegal(g.try({ kind: 'play_card', handIndex: 1, position: 0 }));
    expectIllegal(g.try({ kind: 'play_card', handIndex: 9, position: 0 }));
  });

  it('需要目标的法术没有合法目标时不能使用', () => {
    const g = scenario().hand(0, ['德玛西亚正义']).board(1, ['卡兹克']).build();
    expect(g.legal().some((a) => a.kind === 'play_card')).toBe(false);
  });

  it('where damaged：只能选受伤的', () => {
    const g = scenario().hand(0, ['测试处决']).board(1, ['魔狼', { card: '石甲虫', health: 2, maxHealth: 4 }]).build();
    const targets = g.legal().flatMap((a) => (a.kind === 'play_card' && a.target ? [a.target] : []));
    expect(targets).toEqual([g.m(1, '石甲虫')]);
    g.play('测试处决', { target: g.m(1, '石甲虫') });
    expect(g.has(1, '石甲虫')).toBe(false);
  });

  it('other_friendly_minion：不能选自己', () => {
    const g = scenario().hand(0, ['测试护盾']).build();
    // 场上没有别的友方随从，战吼没有目标，照常入场
    g.play('测试护盾');
    expect(g.kinds()).not.toContain('trigger');
    const g2 = scenario().board(0, ['魔狼']).hand(0, ['测试护盾']).build();
    g2.play('测试护盾', { target: g2.m(0, '魔狼') });
    expect(g2.minion(0, '魔狼').keywords).toContain('divine_shield');
  });
});

describe('死亡结算与胜负（2.6、2.10）', () => {
  it('生命值小于等于 0 的随从同时离场，death 事件带离场前位置', () => {
    const g = scenario().board(1, ['石甲虫', '魔狼', '远程小兵']).hand(0, ['审判']).build();
    g.play('审判');
    expect(g.boardNames(1)).toEqual(['石甲虫']);
    const deaths = g.eventsOf('death');
    expect(deaths.map((d) => d.position)).toEqual([1, 2]);
    expect(new Set(deaths.map((d) => d.group)).size).toBe(1);
  });

  it('一方英雄生命值小于等于 0，另一方获胜', () => {
    const g = scenario().health(1, 3).board(0, ['魔狼']).build();
    g.attack(g.m(0, '魔狼'), g.hero(1));
    expect(g.state.phase).toBe('over');
    expect(g.state.winner).toBe(0);
    expect(g.eventsOf('game_over')[0].winner).toBe(0);
    expect(g.legal(0)).toEqual([]);
    expectIllegal(g.try({ kind: 'end_turn' }));
  });

  it('双方同时小于等于 0 为平局', () => {
    const g = scenario().health(0, 1).health(1, 1).board(0, ['测试双英雄炸弹']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(0, '测试双英雄炸弹') });
    expect(g.state.winner).toBe('draw');
    expect(g.eventsOf('game_over')).toHaveLength(1);
  });

  it('亡语结算完再判定胜负：亡语的治疗可以救回英雄', () => {
    // 对方的亡语先结算（入场早），把我方英雄打到 0；我方的吸血亡语后结算，把英雄救回 2
    const g = scenario().health(0, 2).board(1, ['测试吸血针']).board(0, ['测试吸血针']).hand(0, ['测试全场伤害']).build();
    g.play('测试全场伤害');
    expect(g.eventsOf('damage').some((e) => e.target.kind === 'hero' && e.target.side === 0 && e.healthAfter === 0)).toBe(true);
    expect(g.state.phase).toBe('playing');
    expect(g.p(0).hero.health).toBe(2);
  });
});

describe('法力（2.8）', () => {
  it('法力药水：本回合多一个水晶，回合结束消失', () => {
    const g = scenario().mana(0, 3, 3).hand(0, ['法力药水']).build();
    g.play('法力药水');
    expect(g.p(0).mana).toEqual({ max: 3, current: 4, temp: 1 });
    g.endTurn();
    expect(g.p(0).mana).toEqual({ max: 3, current: 3, temp: 0 });
    g.endTurn();
    expect(g.p(0).mana).toEqual({ max: 4, current: 4, temp: 0 });
  });

  it('临时水晶不能让法力超过 10', () => {
    const g = scenario().mana(0, 10, 10).hand(0, ['法力药水']).build();
    g.play('法力药水');
    expect(g.p(0).mana).toEqual({ max: 10, current: 10, temp: 0 });
  });

  it('花费法力时临时水晶跟着减少，不超过当前法力', () => {
    const g = scenario().mana(0, 1, 1).hand(0, ['法力药水', '魔狼']).build();
    g.play('法力药水');
    g.play('魔狼');
    expect(g.p(0).mana).toEqual({ max: 1, current: 0, temp: 0 });
  });

  it('空水晶永久提高上限，不回复法力', () => {
    const g = scenario().mana(0, 5, 5).hand(0, ['凛冬将至']).build();
    g.play('凛冬将至');
    expect(g.p(0).mana).toEqual({ max: 6, current: 3, temp: 0 });
    g.endTurn().endTurn();
    expect(g.p(0).mana.max).toBe(7);
  });

  it('上限已经是 10 时，空水晶改为抽一张牌', () => {
    const g = scenario().mana(0, 10, 10).hand(0, ['凛冬将至']).build();
    g.play('凛冬将至');
    expect(g.p(0).mana.max).toBe(10);
    expect(g.eventsOf('draw')).toHaveLength(1);
  });

  it('多个空水晶时，超出 10 的部分每个抽一张', () => {
    const g = scenario().mana(0, 9, 9).hand(0, ['测试双空水晶']).build();
    g.play('测试双空水晶');
    expect(g.p(0).mana.max).toBe(10);
    expect(g.eventsOf('draw')).toHaveLength(1);
  });
});

describe('疲劳、爆牌与满员（2.9）', () => {
  it('牌库为空时抽牌：英雄受到疲劳伤害，依次递增', () => {
    const g = scenario().deck(1, []).build();
    g.endTurn();
    expect(g.p(1).hero.health).toBe(29);
    expect(g.eventsOf('fatigue')[0].amount).toBe(1);
    g.endTurn().endTurn();
    expect(g.p(1).hero.health).toBe(27);
    expect(g.p(1).fatigue).toBe(2);
  });

  it('疲劳打死英雄就输', () => {
    const g = scenario().deck(1, []).health(1, 3).fatigue(1, 2).build();
    g.endTurn();
    expect(g.state.winner).toBe(0);
  });

  it('手牌已有 10 张时抽牌：抽到的牌直接销毁', () => {
    const g = scenario().hand(1, Array(10).fill('魔狼')).deck(1, ['雷克塞']).build();
    g.endTurn();
    expect(g.p(1).hand).toHaveLength(10);
    expect(g.p(1).deck).toHaveLength(0);
    expect(g.eventsOf('burn')[0].card.cardId).toBe('neutral.reksai');
  });

  it('手牌已有 10 张时随从被移回手牌：直接销毁，不触发亡语', () => {
    const g = scenario().hand(1, Array(10).fill('魔狼')).board(1, ['迅捷蟹']).hand(0, ['测试回手']).build();
    g.play('测试回手', { target: g.m(1, '迅捷蟹') });
    expect(g.p(1).board).toHaveLength(0);
    expect(g.p(1).hand).toHaveLength(10);
    const b = g.eventsOf('bounce')[0];
    expect(b).toMatchObject({ destroyed: true, handIndex: null });
    expect(g.kinds()).not.toContain('trigger');
    expect(g.kinds()).not.toContain('death');
  });

  it('效果里的召唤：场上满了就不召唤，没有补偿', () => {
    const g = scenario().board(0, Array(6).fill('近战小兵')).hand(0, ['嘉文四世']).build();
    g.play('嘉文四世');
    expect(g.p(0).board).toHaveLength(7);
    expect(g.eventsOf('minion_summoned')).toHaveLength(1);
  });

  it('效果只有召唤的英雄技能和法术在场上满员时不能使用', () => {
    const g = scenario().board(0, Array(7).fill('近战小兵')).hand(0, ['测试召唤']).build();
    expect(g.legal().filter((a) => a.kind !== 'end_turn' && a.kind !== 'attack')).toEqual([]);
    expectIllegal(g.try({ kind: 'hero_power' }));
    expectIllegal(g.try(g.playAction('测试召唤')));
  });
});

describe('召唤位置（2.12）', () => {
  it('战吼召唤的放在本随从右边，多个时依次向右', () => {
    const g = scenario().board(0, ['近战小兵', '远程小兵']).hand(0, ['嘉文四世']).build();
    g.play('嘉文四世', { pos: 1 });
    expect(g.boardNames(0)).toEqual(['近战小兵', '嘉文四世', '德玛西亚士兵', '德玛西亚士兵', '远程小兵']);
    expect(g.eventsOf('minion_summoned').map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it('亡语召唤的放在死者原来的位置，多个时从那个位置依次向右', () => {
    const g = scenario().board(0, ['近战小兵', '虚空幼虫', '远程小兵']).hand(0, ['测试飞弹', '测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(0, '虚空幼虫') });
    g.play('测试飞弹', { target: g.m(0, '虚空幼虫') });
    expect(g.boardNames(0)).toEqual(['近战小兵', '虚空蠕虫', '虚空蠕虫', '远程小兵']);
    expect(g.eventsOf('minion_summoned').map((e) => e.position)).toEqual([1, 2]);
  });

  it('同时死亡的多个亡语各自回到原位置', () => {
    const g = scenario()
      .board(1, ['虚空幼虫', '石甲虫', '虚空幼虫'])
      .hand(0, ['审判'])
      .build();
    g.play('审判');
    expect(g.boardNames(1)).toEqual(['虚空蠕虫', '虚空蠕虫', '石甲虫', '虚空蠕虫', '虚空蠕虫']);
  });

  it('英雄技能和法术召唤的放在场上最右边', () => {
    const g = scenario().board(0, ['近战小兵']).hand(0, ['测试召唤']).build();
    g.heroPower();
    g.play('测试召唤');
    expect(g.boardNames(0)).toEqual(['近战小兵', '德玛西亚士兵', '松鼠', '松鼠']);
    expect(g.eventsOf('minion_summoned', g.log).map((e) => e.via)).toEqual(['hero_power', 'effect', 'effect']);
  });

  it('位置不够时能放几个放几个', () => {
    const g = scenario().board(0, [...Array(5).fill('近战小兵'), '测试亡语三连']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(0, '测试亡语三连') });
    expect(g.p(0).board).toHaveLength(7);
    expect(g.boardNames(0).slice(5)).toEqual(['松鼠', '松鼠']);
  });
});

describe('变形（2.13）', () => {
  it('占原来的位置，是全新的随从：没有原来的增益、伤害和冻结', () => {
    const g = scenario()
      .board(1, ['近战小兵', { card: '雷克塞', attack: 6, health: 2, maxHealth: 8, frozenAt: 4, keywords: ['taunt', 'divine_shield'] }, '远程小兵'])
      .hand(0, ['璐璐'])
      .build();
    const oldId = g.minion(1, '雷克塞').instanceId;
    g.play('璐璐', { target: g.m(1, '雷克塞') });
    expect(g.boardNames(1)).toEqual(['近战小兵', '松鼠', '远程小兵']);
    const sq = g.minion(1, '松鼠');
    expect([sq.attack, sq.health, sq.maxHealth, sq.frozenAt, sq.keywords, sq.buffs]).toEqual([1, 1, 1, undefined, [], []]);
    expect(sq.instanceId).not.toBe(oldId);
    expect(g.eventsOf('transform')[0]).toMatchObject({ position: 1, cardId: 'neutral.reksai', into: 'token.squirrel' });
  });

  it('变形出来的随从带自己卡面的关键词和效果，包括亡语', () => {
    const g = scenario().board(0, ['冰凤凰蛋']).current(1).turn(5, 1).build();
    g.endTurn();
    const anivia = g.minion(0, '艾尼维亚');
    expect(anivia.enteredTurn).toBe(6);
    g.state.players[1].hand.push({ instanceId: 900, cardId: 'demacia.demacian_justice' });
    g.endTurn();
    g.apply({ kind: 'play_card', handIndex: g.p(1).hand.length - 2, target: g.m(0, '艾尼维亚') });
    expect(g.has(0, '冰凤凰蛋')).toBe(true);
  });

  it('变形不算死亡，不触发原随从的亡语', () => {
    const g = scenario().board(1, ['虚空幼虫']).hand(0, ['璐璐']).build();
    g.play('璐璐', { target: g.m(1, '虚空幼虫') });
    expect(g.boardNames(1)).toEqual(['松鼠']);
    expect(g.kinds()).not.toContain('death');
  });

  it('变形出来的随从当回合不能攻击', () => {
    const g = scenario().board(0, ['冰凤凰蛋']).current(1).turn(5, 1).build();
    g.endTurn();
    expect(g.legal().some((a) => a.kind === 'attack')).toBe(false);
  });

  it('变形的目标可以是任何卡牌 id，不限于衍生物', () => {
    const g = scenario().board(1, ['魔狼']).hand(0, ['测试变形']).build();
    g.play('测试变形', { target: g.m(1, '魔狼') });
    expect(g.boardNames(1)).toEqual(['云端亚龙']);
  });
});

describe('回手', () => {
  it('随从回到拥有者手牌末尾，变回卡面状态', () => {
    const g = scenario().board(1, [{ card: '魔狼', health: 1, attack: 6 }]).hand(0, ['测试回手']).build();
    const id = g.minion(1, '魔狼').instanceId;
    g.play('测试回手', { target: g.m(1, '魔狼') });
    expect(g.p(1).board).toHaveLength(0);
    const last = g.p(1).hand[g.p(1).hand.length - 1];
    expect(last).toEqual({ instanceId: id, cardId: 'neutral.murk_wolf' });
    expect(g.eventsOf('bounce')[0]).toMatchObject({ destroyed: false, handIndex: g.p(1).hand.length - 1, position: 0 });
  });
});

describe('消灭触发 on_kill（3.4）', () => {
  it('攻击时消灭对方随从触发，被攻击时反杀也触发', () => {
    const g = scenario().board(0, ['科加斯']).board(1, ['魔狼', '远程小兵']).build();
    g.attack(g.m(0, '科加斯'), g.m(1, '魔狼'));
    expect(g.minion(0, '科加斯').attack).toBe(5);
    expect(g.eventsOf('trigger')[0].timing).toBe('on_kill');
    g.endTurn();
    g.attack(g.m(1, '远程小兵'), g.m(0, '科加斯'));
    expect(g.minion(0, '科加斯').attack).toBe(6);
  });

  it('剧毒导致的死亡也算', () => {
    const g = scenario().board(0, [{ card: '科加斯', keywords: ['poisonous'] }]).board(1, [{ card: '超级兵', attack: 0 }]).build();
    g.attack(g.m(0, '科加斯'), g.m(1, '超级兵'));
    expect(g.minion(0, '科加斯').attack).toBe(5);
  });

  it('法术造成的死亡不算', () => {
    const g = scenario().board(0, ['科加斯']).board(1, ['远程小兵']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(1, '远程小兵') });
    expect(g.minion(0, '科加斯').attack).toBe(4);
  });

  it('同归于尽时不触发', () => {
    const g = scenario().board(0, [{ card: '科加斯', health: 1 }]).board(1, ['魔狼']).build();
    g.attack(g.m(0, '科加斯'), g.m(1, '魔狼'));
    expect(g.p(0).board).toHaveLength(0);
    expect(g.kinds()).not.toContain('trigger');
  });

  it('只打伤没打死不触发', () => {
    const g = scenario().board(0, ['科加斯']).board(1, ['雷克塞']).build();
    g.attack(g.m(0, '科加斯'), g.m(1, '雷克塞'));
    expect(g.kinds()).not.toContain('trigger');
  });
});

describe('再次攻击 extra_attack（测试卡）', () => {
  it('自己回合消灭随从后可以再攻击一次，杀一个就能再打一次', () => {
    const g = scenario().board(0, [{ card: '测试再次攻击', health: 10 }]).board(1, ['近战小兵', '远程小兵', '石甲虫']).build();
    g.attack(g.m(0, '测试再次攻击'), g.m(1, '石甲虫')); // 石甲虫有嘲讽，先打它
    g.attack(g.m(0, '测试再次攻击'), g.m(1, '近战小兵'));
    g.attack(g.m(0, '测试再次攻击'), g.m(1, '远程小兵'));
    expect(g.p(1).board).toHaveLength(0);
    // 第三次攻击打死了远程小兵，还能再打
    g.attack(g.m(0, '测试再次攻击'), g.hero(1));
    // 打英雄不是消灭随从，不能再打了
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '测试再次攻击'), target: g.hero(1) }));
  });

  it('没有消灭就只能攻击一次', () => {
    const g = scenario().board(0, ['测试再次攻击']).board(1, ['布隆']).build();
    g.attack(g.m(0, '测试再次攻击'), g.m(1, '布隆'));
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '测试再次攻击'), target: g.hero(1) }));
  });

  it('对方回合被攻击时反杀：算消灭（发 trigger），但再次攻击只在拥有者自己的回合生效', () => {
    const g = scenario().board(0, ['魔狼']).board(1, [{ card: '测试再次攻击', attacksThisTurn: 0 }]).build();
    g.attack(g.m(0, '魔狼'), g.m(1, '测试再次攻击'));
    expect(g.eventsOf('trigger')[0]).toMatchObject({ timing: 'on_kill' });
    expect(g.minion(1, '测试再次攻击').extraAttacks).toBe(0);
    g.endTurn();
    // 自己回合正常攻击一次后不能再打
    g.attack(g.m(1, '测试再次攻击'), g.hero(0));
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(1, '测试再次攻击'), target: g.hero(0) }));
  });

  it('额外攻击次数在回合结束时清零', () => {
    const g = scenario().board(0, ['测试再次攻击']).board(1, ['近战小兵']).build();
    g.attack(g.m(0, '测试再次攻击'), g.m(1, '近战小兵'));
    expect(g.minion(0, '测试再次攻击').extraAttacks).toBe(1);
    g.endTurn();
    expect(g.minion(0, '测试再次攻击').extraAttacks).toBe(0);
  });
});

describe('自动目标（3.4 ActionTarget）', () => {
  it('all_minions 打双方所有随从', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['魔狼']).hand(0, ['测试全场伤害']).build();
    g.play('测试全场伤害');
    expect(g.minion(0, '魔狼').health).toBe(1);
    expect(g.minion(1, '魔狼').health).toBe(1);
    expect(new Set(g.eventsOf('damage').map((e) => e.group)).size).toBe(1);
  });

  it('random_enemy_minion 没有目标时什么也不做', () => {
    const g = scenario().hand(0, ['测试随机飞弹']).build();
    g.play('测试随机飞弹');
    expect(g.kinds()).not.toContain('damage');
  });

  it('random_enemy_minion 由种子决定，同种子同结果', () => {
    const pick = (seed: number) => {
      const g = scenario().seed(seed).board(1, ['雷克塞', '超级兵', '石甲虫']).hand(0, ['测试随机飞弹']).build();
      g.play('测试随机飞弹');
      return g.eventsOf('damage')[0].target;
    };
    expect(pick(3)).toEqual(pick(3));
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => JSON.stringify(pick(s))));
    expect(seen.size).toBeGreaterThan(1);
  });
});
