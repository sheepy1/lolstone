// 每个关键词一组测试，覆盖 spec 3.3 定义里的每一句话，以及 2.5–2.7 的相关规则。
import { describe, expect, it } from 'vitest';
import { expectIllegal, scenario } from './helpers/scenario';

describe('嘲讽', () => {
  it('对方攻击时必须先打嘲讽随从：英雄和非嘲讽随从都不能打', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['近战小兵', '石甲虫']).build();
    const targets = g.legal().filter((a) => a.kind === 'attack').map((a) => (a.kind === 'attack' ? a.target : null));
    expect(targets).toEqual([g.m(1, '石甲虫')]);
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '魔狼'), target: g.hero(1) }));
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '魔狼'), target: g.m(1, '近战小兵') }));
    g.attack(g.m(0, '魔狼'), g.m(1, '石甲虫'));
  });

  it('有多个嘲讽时可以任选一个', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['石甲虫', '近战小兵', '超级兵']).build();
    const targets = g.legal().filter((a) => a.kind === 'attack');
    expect(targets).toHaveLength(2);
  });

  it('潜行时嘲讽不生效：可以绕过它打英雄和别的随从', () => {
    const g = scenario()
      .board(0, ['魔狼'])
      .board(1, [{ card: '石甲虫', keywords: ['taunt', 'stealth'] }, '近战小兵'])
      .build();
    const targets = g.legal().flatMap((a) => (a.kind === 'attack' ? [a.target] : []));
    expect(targets).toEqual([g.hero(1), g.m(1, '近战小兵')]);
    g.attack(g.m(0, '魔狼'), g.hero(1));
    expect(g.p(1).hero.health).toBe(27);
  });

  it('嘲讽只限制攻击，不限制法术目标', () => {
    const g = scenario().board(1, ['石甲虫', '近战小兵']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(1, '近战小兵') });
    expect(g.minion(1, '近战小兵').health).toBe(1);
  });
});

describe('冲锋', () => {
  it('入场当回合就能攻击，可以打英雄', () => {
    const g = scenario().hand(0, ['赵信']).board(1, ['近战小兵']).build();
    g.play('赵信');
    g.attack(g.m(0, '赵信'), g.hero(1));
    expect(g.p(1).hero.health).toBe(27);
  });

  it('没有冲锋或突袭的随从入场当回合不能攻击', () => {
    const g = scenario().hand(0, ['魔狼']).build();
    g.play('魔狼');
    expect(g.legal().some((a) => a.kind === 'attack')).toBe(false);
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '魔狼'), target: g.hero(1) }));
  });
});

describe('突袭', () => {
  it('入场当回合就能攻击，但只能打随从', () => {
    const g = scenario().hand(0, ['炮车']).board(1, ['近战小兵']).build();
    g.play('炮车');
    const attacks = g.legal().filter((a) => a.kind === 'attack');
    expect(attacks.map((a) => (a.kind === 'attack' ? a.target.kind : ''))).toEqual(['minion']);
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '炮车'), target: g.hero(1) }));
    g.attack(g.m(0, '炮车'), g.m(1, '近战小兵'));
    expect(g.has(1, '近战小兵')).toBe(false);
  });

  it('对方没有随从时，突袭随从入场当回合没有可打的目标', () => {
    const g = scenario().hand(0, ['炮车']).build();
    g.play('炮车');
    expect(g.legal().some((a) => a.kind === 'attack')).toBe(false);
  });

  it('下一回合起可以打英雄', () => {
    const g = scenario().board(0, [{ card: '炮车', enteredTurn: 4 }]).build();
    g.attack(g.m(0, '炮车'), g.hero(1));
    expect(g.p(1).hero.health).toBe(27);
  });

  it('突袭也受嘲讽限制', () => {
    const g = scenario().hand(0, ['炮车']).board(1, ['近战小兵', '石甲虫']).build();
    g.play('炮车');
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '炮车'), target: g.m(1, '近战小兵') }));
  });
});

describe('圣盾', () => {
  it('抵消受到的第一次伤害，然后失去圣盾', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['波比']).build();
    g.attack(g.m(0, '魔狼'), g.m(1, '波比'));
    const poppy = g.minion(1, '波比');
    expect(poppy.health).toBe(3);
    expect(poppy.keywords).not.toContain('divine_shield');
    expect(g.kinds()).toContain('shield_broken');
  });

  it('第二次伤害照常生效', () => {
    const g = scenario().board(1, ['波比']).hand(0, ['测试飞弹', '测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(1, '波比') });
    expect(g.minion(1, '波比').health).toBe(3);
    g.play('测试飞弹', { target: g.m(1, '波比') });
    expect(g.minion(1, '波比').health).toBe(2);
  });

  it('伤害为 0 时不消耗圣盾', () => {
    const g = scenario().board(0, [{ card: '波比', attack: 2 }]).board(1, ['冰凤凰蛋']).build();
    g.attack(g.m(0, '波比'), g.m(1, '冰凤凰蛋'));
    expect(g.minion(0, '波比').keywords).toContain('divine_shield');
  });

  it('被圣盾挡下的伤害不触发剧毒', () => {
    const g = scenario().board(0, ['魔沼蛙']).board(1, ['波比']).build();
    g.attack(g.m(0, '魔沼蛙'), g.m(1, '波比'));
    expect(g.has(1, '波比')).toBe(true);
  });
});

describe('潜行', () => {
  it('不能被攻击', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['卡兹克']).build();
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '魔狼'), target: g.m(1, '卡兹克') }));
  });

  it('不能被对方的指向性效果选中，自己的可以', () => {
    const g = scenario().board(0, ['卡兹克']).board(1, ['卡兹克']).hand(0, ['测试飞弹']).build();
    const targets = g.legal().filter((a) => a.kind === 'play_card').map((a) => (a.kind === 'play_card' ? a.target : null));
    expect(targets).toContainEqual(g.m(0, '卡兹克'));
    expect(targets).not.toContainEqual(g.m(1, '卡兹克'));
    expectIllegal(g.try(g.playAction('测试飞弹', { target: g.m(1, '卡兹克') })));
  });

  it('攻击之后失去潜行', () => {
    const g = scenario().board(0, ['卡兹克']).build();
    g.attack(g.m(0, '卡兹克'), g.hero(1));
    expect(g.minion(0, '卡兹克').keywords).not.toContain('stealth');
    expect(g.kinds()).toContain('stealth_lost');
  });

  it('群体效果照样打到', () => {
    const g = scenario().board(1, ['卡兹克']).hand(0, ['审判']).build();
    g.play('审判');
    expect(g.minion(1, '卡兹克').health).toBe(1);
  });

  it('随机效果可以选中潜行随从（不是指向性效果）', () => {
    const g = scenario().board(1, ['卡兹克']).hand(0, ['测试随机飞弹']).build();
    g.play('测试随机飞弹');
    expect(g.minion(1, '卡兹克').health).toBe(2);
  });
});

describe('风怒', () => {
  it('每回合可以攻击两次，不能攻击第三次', () => {
    const g = scenario().board(0, ['测试风怒']).build();
    g.attack(g.m(0, '测试风怒'), g.hero(1));
    g.attack(g.m(0, '测试风怒'), g.hero(1));
    expect(g.p(1).hero.health).toBe(26);
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '测试风怒'), target: g.hero(1) }));
  });

  it('没有风怒的随从每回合只能攻击一次，下回合重置', () => {
    const g = scenario().board(0, ['魔狼']).build();
    g.attack(g.m(0, '魔狼'), g.hero(1));
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '魔狼'), target: g.hero(1) }));
    g.endTurn().endTurn();
    g.attack(g.m(0, '魔狼'), g.hero(1));
    expect(g.p(1).hero.health).toBe(24);
  });
});

describe('吸血', () => {
  it('造成的伤害同时为己方英雄恢复等量生命', () => {
    const g = scenario().health(0, 20).board(0, ['测试吸血']).board(1, ['石甲虫']).build();
    g.attack(g.m(0, '测试吸血'), g.m(1, '石甲虫'));
    expect(g.p(0).hero.health).toBe(23);
    const heal = g.eventsOf('heal')[0];
    expect(heal.target).toEqual(g.hero(0));
  });

  it('恢复不超过生命上限', () => {
    const g = scenario().health(0, 29).board(0, ['测试吸血']).build();
    g.attack(g.m(0, '测试吸血'), g.hero(1));
    expect(g.p(0).hero.health).toBe(30);
  });

  it('被圣盾挡下时没有造成伤害，不恢复', () => {
    const g = scenario().health(0, 20).board(0, ['测试吸血']).board(1, ['波比']).build();
    g.attack(g.m(0, '测试吸血'), g.m(1, '波比'));
    expect(g.p(0).hero.health).toBe(20);
  });

  it('被攻击时反击造成的伤害也吸血', () => {
    const g = scenario().health(1, 20).board(0, ['魔狼']).board(1, ['测试吸血']).build();
    g.attack(g.m(0, '魔狼'), g.m(1, '测试吸血'));
    expect(g.p(1).hero.health).toBe(23);
  });

  it('亡语里的伤害也算本随从造成的，吸血生效', () => {
    const g = scenario().health(0, 20).board(0, ['测试吸血针']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(0, '测试吸血针') });
    expect(g.p(1).hero.health).toBe(28);
    expect(g.p(0).hero.health).toBe(22);
  });
});

describe('剧毒', () => {
  it('对随从造成伤害后，该随从死亡', () => {
    const g = scenario().board(0, ['魔沼蛙']).board(1, ['超级兵']).build();
    g.attack(g.m(0, '魔沼蛙'), g.m(1, '超级兵'));
    expect(g.has(1, '超级兵')).toBe(false);
    expect(g.has(0, '魔沼蛙')).toBe(false);
  });

  it('被攻击时反击也算', () => {
    const g = scenario().board(0, ['超级兵']).board(1, ['薇恩']).build();
    g.attack(g.m(0, '超级兵'), g.m(1, '薇恩'));
    expect(g.has(0, '超级兵')).toBe(false);
  });

  it('对英雄没有额外效果', () => {
    const g = scenario().board(0, ['魔沼蛙']).build();
    g.attack(g.m(0, '魔沼蛙'), g.hero(1));
    expect(g.p(1).hero.health).toBe(28);
  });

  it('效果造成的伤害也带剧毒', () => {
    const g = scenario().board(1, ['超级兵']).hand(0, ['测试毒针']).build();
    g.play('测试毒针', { target: g.m(1, '超级兵') });
    expect(g.has(1, '超级兵')).toBe(false);
  });

  it('剧毒致死不是伤害致死，泰达米尔拦不住', () => {
    const g = scenario().board(0, ['魔沼蛙']).board(1, ['泰达米尔']).build();
    g.attack(g.m(0, '魔沼蛙'), g.m(1, '泰达米尔'));
    expect(g.has(1, '泰达米尔')).toBe(false);
  });
});

describe('法术伤害 +X', () => {
  it('己方法术造成的伤害加 X，多个叠加', () => {
    const g = scenario().board(0, ['蓝色哨兵', '维克兹']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.hero(1) });
    expect(g.p(1).hero.health).toBe(27);
  });

  it('群体法术每个目标都加', () => {
    const g = scenario().board(0, ['蓝色哨兵']).board(1, ['石甲虫', '雷克塞']).hand(0, ['审判']).build();
    g.play('审判');
    expect(g.minion(1, '石甲虫').health).toBe(1);
    expect(g.minion(1, '雷克塞').health).toBe(3);
  });

  it('不影响英雄技能', () => {
    const g = scenario().classes('ionia', 'demacia').board(0, ['蓝色哨兵']).build();
    g.heroPower(g.hero(1));
    expect(g.p(1).hero.health).toBe(29);
  });

  it('不影响战吼', () => {
    const g = scenario().board(0, ['蓝色哨兵']).hand(0, ['拉克丝']).board(1, ['雷克塞']).build();
    g.play('拉克丝', { target: g.m(1, '雷克塞') });
    expect(g.minion(1, '雷克塞').health).toBe(4);
  });

  it('对方的法术伤害不算', () => {
    const g = scenario().board(1, ['蓝色哨兵']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.hero(1) });
    expect(g.p(1).hero.health).toBe(29);
  });

  it('被沉默后失去法术伤害', () => {
    const g = scenario().board(0, [{ card: '蓝色哨兵', silenced: true }]).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.hero(1) });
    expect(g.p(1).hero.health).toBe(29);
  });
});

describe('战吼', () => {
  it('从手牌打出时触发，trigger 事件在动作事件之前', () => {
    const g = scenario().hand(0, ['拉克丝']).board(1, ['雷克塞']).build();
    g.play('拉克丝', { target: g.m(1, '雷克塞') });
    const kinds = g.kinds();
    expect(kinds.indexOf('trigger')).toBeLessThan(kinds.indexOf('damage'));
    expect(kinds.indexOf('minion_summoned')).toBeLessThan(kinds.indexOf('trigger'));
    expect(g.eventsOf('trigger')[0].timing).toBe('battlecry');
  });

  it('有合法目标时必须选目标', () => {
    const g = scenario().hand(0, ['拉克丝']).board(1, ['雷克塞']).build();
    expectIllegal(g.try(g.playAction('拉克丝')));
  });

  it('需要目标的战吼没有合法目标时，随从照常入场，战吼不触发', () => {
    const g = scenario().hand(0, ['瑟庄妮']).board(1, ['卡兹克']).build();
    const plays = g.legal().filter((a) => a.kind === 'play_card');
    expect(plays.every((a) => a.kind === 'play_card' && a.target === undefined)).toBe(true);
    g.play('瑟庄妮');
    expect(g.has(0, '瑟庄妮')).toBe(true);
    expect(g.kinds()).not.toContain('trigger');
  });

  it('变形出来的随从不触发战吼', () => {
    const g = scenario().board(1, ['魔狼']).hand(0, ['测试变形']).build();
    const hand1 = g.p(1).hand.length;
    g.play('测试变形', { target: g.m(1, '魔狼') });
    expect(g.has(1, '云端亚龙')).toBe(true);
    expect(g.p(1).hand.length).toBe(hand1);
    expect(g.kinds()).not.toContain('trigger');
  });

  it('回手后再打出会再次触发', () => {
    const g = scenario().board(0, ['云端亚龙']).hand(0, ['测试回手']).build();
    g.play('测试回手', { target: g.m(0, '云端亚龙') });
    const handBefore = g.p(0).hand.length;
    g.play('云端亚龙');
    expect(g.p(0).hand.length).toBe(handBefore); // 打出一张、战吼抽一张
  });
});

describe('亡语', () => {
  it('死亡时触发', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['迅捷蟹']).build();
    g.attack(g.m(0, '魔狼'), g.m(1, '迅捷蟹'));
    expect(g.eventsOf('draw').map((e) => e.side)).toEqual([1]);
  });

  it('多个随从同时死亡时按入场顺序触发', () => {
    const g = scenario().board(1, ['迅捷蟹']).board(1, ['虚空幼虫']).hand(0, ['审判']).build();
    // 虚空幼虫晚入场
    g.play('审判');
    const timings = g.eventsOf('trigger').map((e) => e.source.kind === 'minion' && e.source.cardId);
    expect(timings).toEqual(['neutral.rift_scuttler', 'neutral.void_larva']);
  });

  it('入场顺序以 summonOrder 为准，不看场上位置', () => {
    const g = scenario().board(1, ['虚空幼虫']).build();
    // 后入场的迅捷蟹放在左边
    g.state.players[1].board.unshift({ ...g.minion(1, '虚空幼虫'), instanceId: 999, cardId: 'neutral.rift_scuttler', summonOrder: 50, health: 1, maxHealth: 1, attack: 2 });
    g.state.players[0].hand.push({ instanceId: 1000, cardId: 'demacia.judgment' });
    g.play('审判');
    const order = g.eventsOf('trigger').map((e) => e.source.kind === 'minion' && e.source.cardId);
    expect(order).toEqual(['neutral.void_larva', 'neutral.rift_scuttler']);
  });

  it('被沉默的随从死亡不触发亡语', () => {
    const g = scenario().board(0, ['魔狼']).board(1, [{ card: '迅捷蟹', silenced: true }]).build();
    g.attack(g.m(0, '魔狼'), g.m(1, '迅捷蟹'));
    expect(g.kinds()).not.toContain('draw');
  });

  it('回手和变形不是死亡，不触发亡语', () => {
    const g = scenario().board(0, ['迅捷蟹', '虚空幼虫']).hand(0, ['测试回手', '璐璐']).build();
    g.play('测试回手', { target: g.m(0, '迅捷蟹') });
    g.play('璐璐', { target: g.m(0, '虚空幼虫') });
    expect(g.kinds(g.log)).not.toContain('death');
    expect(g.eventsOf('trigger', g.log).map((e) => e.timing)).toEqual(['battlecry']);
  });

  it('亡语引发的死亡继续结算，直到没有新的死亡', () => {
    const g = scenario().board(0, ['测试亡语炸弹', '近战小兵']).board(1, [{ card: '测试亡语炸弹' }, '远程小兵']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(0, '测试亡语炸弹') });
    // 第一个炸弹炸死对面的炸弹和远程小兵，第二个炸弹再炸一次，近战小兵 2 血吃两次 1 点死掉
    expect(g.p(0).board).toHaveLength(0);
    expect(g.p(1).board).toHaveLength(0);
    expect(g.eventsOf('death').length).toBe(4);
  });
});

describe('连击', () => {
  it('本回合已经使用过其他牌时，从手牌打出触发', () => {
    const g = scenario().hand(0, ['测试飞弹', '测试连击随从']).build();
    g.play('测试飞弹', { target: g.hero(1) });
    g.play('测试连击随从');
    expect(g.minion(0, '测试连击随从').attack).toBe(4);
    expect(g.eventsOf('trigger')[0].timing).toBe('combo');
  });

  it('本回合第一张牌不触发', () => {
    const g = scenario().hand(0, ['测试连击随从']).build();
    g.play('测试连击随从');
    expect(g.minion(0, '测试连击随从').attack).toBe(2);
    expect(g.kinds()).not.toContain('trigger');
  });

  it('英雄技能不算使用过牌', () => {
    const g = scenario().hand(0, ['测试连击随从']).build();
    g.heroPower();
    g.play('测试连击随从');
    expect(g.minion(0, '测试连击随从').attack).toBe(2);
  });

  it('法力药水算使用过牌', () => {
    const g = scenario().hand(0, ['法力药水', '测试连击随从']).build();
    g.play('法力药水');
    g.play('测试连击随从');
    expect(g.minion(0, '测试连击随从').attack).toBe(4);
  });

  it('回合开始时清零', () => {
    const g = scenario().hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.hero(1) });
    expect(g.p(0).cardsPlayedThisTurn).toBe(1);
    g.endTurn().endTurn();
    expect(g.p(0).cardsPlayedThisTurn).toBe(0);
  });

  it('一张卡可以同时有战吼和连击：先战吼后连击，连击的目标在条件满足时才需要选', () => {
    const g = scenario().hand(0, ['测试战吼连击', '测试战吼连击']).board(1, ['魔狼']).build();
    // 第一张：没有连击，不需要目标
    expect(g.legal().filter((a) => a.kind === 'play_card' && a.handIndex === 0).every((a) => a.kind === 'play_card' && !a.target)).toBe(true);
    g.apply({ kind: 'play_card', handIndex: 0, position: 0 });
    expect(g.eventsOf('trigger').map((e) => e.timing)).toEqual(['battlecry']);
    // 第二张：连击生效，需要选敌方随从
    g.play('测试战吼连击', { target: g.m(1, '魔狼') });
    expect(g.eventsOf('trigger').map((e) => e.timing)).toEqual(['battlecry', 'combo']);
    expect(g.has(1, '魔狼')).toBe(false);
    expect(g.p(1).hand.some((c) => c.cardId === 'neutral.murk_wolf')).toBe(true);
  });
});

describe('激怒', () => {
  it('生命值低于上限时获得效果', () => {
    const g = scenario().board(0, ['近战小兵']).board(1, ['奥拉夫']).current(0).build();
    g.attack(g.m(0, '近战小兵'), g.m(1, '奥拉夫'));
    expect(g.minion(1, '奥拉夫').attack).toBe(4);
    expect(g.eventsOf('buff').some((e) => e.reason === 'enrage')).toBe(true);
  });

  it('恢复满就失去', () => {
    const g2 = scenario().board(0, ['奥拉夫']).hand(0, ['测试飞弹', '测试治疗']).build();
    g2.play('测试飞弹', { target: g2.m(0, '奥拉夫') });
    expect(g2.minion(0, '奥拉夫').attack).toBe(4);
    g2.play('测试治疗', { target: g2.m(0, '奥拉夫') });
    expect(g2.minion(0, '奥拉夫').attack).toBe(2);
    expect(g2.minion(0, '奥拉夫').buffs).toHaveLength(0);
  });

  it('激怒给的生命值和关键词也随之增减', () => {
    const g = scenario().board(0, ['测试激怒']).hand(0, ['测试飞弹', '测试治疗']).build();
    g.play('测试飞弹', { target: g.m(0, '测试激怒') });
    let m = g.minion(0, '测试激怒');
    expect([m.attack, m.health, m.maxHealth]).toEqual([2, 4, 5]);
    expect(m.keywords).toContain('windfury');
    g.play('测试治疗', { target: g.m(0, '测试激怒') });
    m = g.minion(0, '测试激怒');
    expect([m.attack, m.health, m.maxHealth]).toEqual([1, 4, 4]);
    expect(m.keywords).not.toContain('windfury');
  });

  it('沉默后不再激怒', () => {
    const g = scenario().board(0, ['奥拉夫']).hand(0, ['测试飞弹', '卢锡安']).build();
    g.play('测试飞弹', { target: g.m(0, '奥拉夫') });
    g.play('卢锡安', { target: g.m(0, '奥拉夫') });
    expect(g.minion(0, '奥拉夫').attack).toBe(2);
  });
});

describe('冻结', () => {
  it('被冻结的随从不能攻击', () => {
    const g = scenario().board(0, [{ card: '魔狼', frozenAt: 4 }]).build();
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '魔狼'), target: g.hero(1) }));
  });

  it('对方回合里被冻结：到你的下个回合不能攻击，你那个回合结束时解冻', () => {
    const g = scenario().board(0, ['魔狼']).classes('freljord', 'freljord').current(1).turn(5, 1).build();
    g.heroPower(g.m(0, '魔狼'));
    expect(g.minion(0, '魔狼').frozenAt).toBe(5);
    g.endTurn(); // 第 6 回合，玩家0
    expect(g.minion(0, '魔狼').frozenAt).toBe(5);
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '魔狼'), target: g.hero(1) }));
    g.endTurn(); // 玩家0 回合结束，解冻
    expect(g.minion(0, '魔狼').frozenAt).toBeUndefined();
    expect(g.eventsOf('unfreeze')).toHaveLength(1);
  });

  it('自己回合里被冻结：这回合结束时不解冻，下回合也不能攻击，下回合结束时才解冻', () => {
    const g = scenario().board(0, ['超级兵']).hand(0, ['魔法水晶箭']).build();
    g.play('魔法水晶箭', { target: g.m(0, '超级兵') });
    g.endTurn(); // 第 5 回合结束，不解冻
    expect(g.minion(0, '超级兵').frozenAt).toBe(5);
    g.endTurn(); // 第 7 回合，玩家0
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(0, '超级兵'), target: g.hero(1) }));
    g.endTurn();
    expect(g.minion(0, '超级兵').frozenAt).toBeUndefined();
  });

  it('只在拥有者的回合结束时解冻', () => {
    const g = scenario().board(1, [{ card: '魔狼', frozenAt: 3 }]).build();
    g.endTurn();
    expect(g.minion(1, '魔狼').frozenAt).toBe(3);
  });

  it('英雄不能被冻结：冻结英雄直接忽略，不发事件，伤害照常', () => {
    const g = scenario().hand(0, ['魔法水晶箭']).build();
    g.play('魔法水晶箭', { target: g.hero(1) });
    expect(g.p(1).hero.health).toBe(27);
    expect(g.kinds()).not.toContain('freeze');
  });

  it('沉默同时解除冻结', () => {
    const g = scenario().board(1, [{ card: '魔狼', frozenAt: 4 }]).hand(0, ['卢锡安']).build();
    g.play('卢锡安', { target: g.m(1, '魔狼') });
    expect(g.minion(1, '魔狼').frozenAt).toBeUndefined();
    expect(g.eventsOf('unfreeze')[0].reason).toBe('silence');
  });
});

describe('沉默', () => {
  it('移除关键词和所有增减益，攻击力和生命上限回到卡面', () => {
    const g = scenario().board(0, ['波比']).hand(0, ['铁誓', '卢锡安']).build();
    g.play('铁誓', { target: g.m(0, '波比') });
    expect(g.minion(0, '波比').attack).toBe(4);
    g.play('卢锡安', { target: g.m(0, '波比') });
    const poppy = g.minion(0, '波比');
    expect([poppy.attack, poppy.health, poppy.maxHealth]).toEqual([2, 3, 3]);
    expect(poppy.keywords).toEqual([]);
    expect(poppy.buffs).toEqual([]);
    expect(poppy.silenced).toBe(true);
    expect(g.eventsOf('silence')[0].keywordsLost.sort()).toEqual(['divine_shield', 'taunt']);
  });

  it('移除卡面文本效果：回合结束效果不再触发', () => {
    const g = scenario().board(0, ['纳什男爵', '近战小兵']).hand(0, ['卢锡安']).build();
    g.play('卢锡安', { target: g.m(0, '纳什男爵') });
    g.endTurn();
    expect(g.eventsOf('trigger')).toHaveLength(0);
    expect(g.minion(0, '近战小兵').attack).toBe(1);
  });

  it('当前生命值超过新上限时降到上限；没超过的保留伤害', () => {
    const g = scenario()
      .board(1, [{ card: '加里奥', attack: 5, health: 9, maxHealth: 9 }, { card: '雷克塞', attack: 5, health: 4, maxHealth: 8 }])
      .hand(0, ['测试群体沉默'])
      .build();
    g.play('测试群体沉默');
    expect(g.minion(1, '加里奥').health).toBe(7);
    expect(g.minion(1, '雷克塞').health).toBe(4);
    expect(g.minion(1, '雷克塞').maxHealth).toBe(6);
  });

  it('沉默后还能获得新的增益和关键词', () => {
    const g = scenario().board(0, [{ card: '波比', silenced: true, keywords: [] }]).hand(0, ['光盾']).build();
    g.play('光盾', { target: g.m(0, '波比') });
    expect(g.minion(0, '波比').keywords).toEqual(['divine_shield']);
  });

  it('沉默移除脚本效果（菲奥娜、泰达米尔）', () => {
    const g = scenario().board(0, [{ card: '菲奥娜', silenced: true }]).board(1, ['魔狼']).build();
    g.attack(g.m(0, '菲奥娜'), g.m(1, '魔狼'));
    expect(g.minion(0, '菲奥娜').health).toBe(1);
  });
});

describe('攻击（spec 2.5）', () => {
  it('攻击力为 0 的随从不能攻击', () => {
    const g = scenario().board(0, ['冰凤凰蛋']).build();
    expect(g.legal().some((a) => a.kind === 'attack')).toBe(false);
  });

  it('双方同时对对方造成等于自身攻击力的伤害', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['石甲虫']).build();
    g.attack(g.m(0, '魔狼'), g.m(1, '石甲虫'));
    expect(g.minion(0, '魔狼').health).toBe(1);
    expect(g.minion(1, '石甲虫').health).toBe(1);
    const dmg = g.eventsOf('damage');
    expect(dmg).toHaveLength(2);
    expect(new Set([...dmg.map((e) => e.group), g.eventsOf('attack')[0].group]).size).toBe(1);
  });

  it('英雄攻击力为 0，不反击', () => {
    const g = scenario().board(0, ['魔狼']).build();
    g.attack(g.m(0, '魔狼'), g.hero(1));
    expect(g.minion(0, '魔狼').health).toBe(2);
    expect(g.eventsOf('damage')).toHaveLength(1);
  });

  it('不是当前玩家的随从不能攻击', () => {
    const g = scenario().board(1, ['魔狼']).build();
    expect(g.legal(1)).toEqual([]);
    expectIllegal(g.try({ kind: 'attack', attacker: g.m(1, '魔狼'), target: g.hero(0) }));
  });
});
