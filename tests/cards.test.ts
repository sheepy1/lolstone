// 每张卡一个测试（spec 6.7）：M1 范围内的全部中立卡、德玛西亚、弗雷尔卓德、四个英雄技能、全部衍生物。
// 身材和关键词按 cards-v1.md 的表格手抄一份来比，保证卡面文本和数据一致。
import { describe, expect, it } from 'vitest';
import { CARD_POOL } from '../src/cards';
import type { Keyword } from '../src/engine';
import { cardByName, expectIllegal, scenario } from './helpers/scenario';

const covered = new Set<string>();

function card(name: string, fn: () => void): void {
  covered.add(cardByName(name).id);
  it(name, fn);
}

// 从手牌打出，检查费用、身材和关键词。
function expectStats(name: string, cost: number, attack: number, health: number, keywords: Keyword[] = []): void {
  const g = scenario().mana(0, cost, cost).hand(0, [name]).build();
  g.play(name);
  expect(g.p(0).mana.current).toBe(0);
  const m = g.minion(0, name);
  expect([m.attack, m.health, m.maxHealth]).toEqual([attack, health, health]);
  expect([...m.keywords].sort()).toEqual([...keywords].sort());
}

describe('中立', () => {
  card('近战小兵', () => expectStats('近战小兵', 1, 1, 2));
  card('远程小兵', () => expectStats('远程小兵', 1, 2, 1));
  card('魔狼', () => expectStats('魔狼', 2, 3, 2));

  card('提莫', () => {
    expectStats('提莫', 2, 1, 1, ['stealth', 'poisonous']);
    const g = scenario().board(0, ['提莫']).board(1, ['超级兵']).build();
    g.attack(g.m(0, '提莫'), g.m(1, '超级兵'));
    expect(g.has(1, '超级兵')).toBe(false);
  });

  card('迅捷蟹', () => {
    expectStats('迅捷蟹', 2, 2, 1);
    const g = scenario().board(1, ['迅捷蟹']).hand(0, ['测试飞弹']).build();
    const n = g.p(1).hand.length;
    g.play('测试飞弹', { target: g.m(1, '迅捷蟹') });
    expect(g.p(1).hand.length).toBe(n + 1);
  });

  card('石甲虫', () => expectStats('石甲虫', 2, 1, 4, ['taunt']));

  card('虚空幼虫', () => {
    expectStats('虚空幼虫', 2, 1, 2);
    const g = scenario().board(1, ['虚空幼虫']).board(0, ['魔狼']).build();
    g.attack(g.m(0, '魔狼'), g.m(1, '虚空幼虫'));
    expect(g.boardNames(1)).toEqual(['虚空蠕虫', '虚空蠕虫']);
  });

  card('魔沼蛙', () => {
    expectStats('魔沼蛙', 3, 2, 3, ['poisonous']);
    const g = scenario().board(0, ['魔沼蛙']).board(1, ['雷克塞']).build();
    g.attack(g.m(0, '魔沼蛙'), g.m(1, '雷克塞'));
    expect(g.has(1, '雷克塞')).toBe(false);
  });

  card('蓝色哨兵', () => {
    expectStats('蓝色哨兵', 3, 2, 4);
    const g = scenario().board(0, ['蓝色哨兵']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.hero(1) });
    expect(g.p(1).hero.health).toBe(28);
  });

  card('璐璐', () => {
    expectStats('璐璐', 4, 2, 3);
    const g = scenario().board(0, ['超级兵']).hand(0, ['璐璐']).build();
    g.play('璐璐', { target: g.m(0, '超级兵') }); // 友方随从也能选
    expect(g.boardNames(0)).toEqual(['松鼠', '璐璐']);
  });

  card('卡兹克', () => expectStats('卡兹克', 4, 4, 3, ['stealth']));

  card('炮车', () => expectStats('炮车', 4, 3, 3, ['rush']));

  card('猩红印记', () => {
    expectStats('猩红印记', 4, 3, 4);
    const g = scenario().board(0, ['魔狼']).hand(0, ['猩红印记']).build();
    g.play('猩红印记', { target: g.m(0, '魔狼') });
    expect(g.minion(0, '魔狼').attack).toBe(5);
    // 不能选敌方随从
    const g2 = scenario().board(1, ['魔狼']).hand(0, ['猩红印记']).build();
    expectIllegal(g2.try(g2.playAction('猩红印记', { target: g2.m(1, '魔狼') })));
  });

  card('雷克塞', () => expectStats('雷克塞', 5, 3, 6, ['taunt']));
  card('峡谷先锋', () => expectStats('峡谷先锋', 5, 5, 4, ['rush']));

  card('维克兹', () => {
    const g = scenario().mana(0, 6).hand(0, ['维克兹', '测试飞弹']).build();
    g.play('维克兹', { target: g.hero(1) });
    // 战吼不吃自己的法术伤害
    expect(g.p(1).hero.health).toBe(28);
    const m = g.minion(0, '维克兹');
    expect([m.attack, m.health]).toEqual([3, 4]);
    g.play('测试飞弹', { target: g.hero(1) });
    expect(g.p(1).hero.health).toBe(26);
  });

  card('炼狱亚龙', () => {
    const g = scenario().board(0, ['近战小兵', '魔狼']).board(1, ['魔狼']).hand(0, ['炼狱亚龙']).build();
    g.play('炼狱亚龙');
    expect(g.p(0).board.map((m) => m.attack)).toEqual([2, 4, 4]);
    expect(g.minion(1, '魔狼').attack).toBe(3);
  });

  card('山脉亚龙', () => {
    const g = scenario().board(0, ['近战小兵']).hand(0, ['山脉亚龙']).build();
    g.play('山脉亚龙');
    expect(g.minion(0, '近战小兵').health).toBe(3);
    expect(g.minion(0, '山脉亚龙').health).toBe(5);
  });

  card('海洋亚龙', () => {
    const g = scenario().health(0, 28).hand(0, ['海洋亚龙']).build();
    g.play('海洋亚龙');
    expect(g.p(0).hero.health).toBe(30); // 不超过上限
    expect(g.minion(0, '海洋亚龙').attack).toBe(4);
  });

  card('云端亚龙', () => {
    const g = scenario().hand(0, ['云端亚龙']).build();
    g.play('云端亚龙');
    expect(g.p(0).hand).toHaveLength(1);
  });

  card('科加斯', () => {
    expectStats('科加斯', 6, 5, 6);
    const g = scenario().board(0, ['科加斯']).board(1, ['魔狼']).build();
    g.attack(g.m(0, '科加斯'), g.m(1, '魔狼'));
    const m = g.minion(0, '科加斯');
    expect([m.attack, m.health, m.maxHealth]).toEqual([6, 4, 7]);
  });

  card('超级兵', () => expectStats('超级兵', 6, 5, 6, ['taunt']));

  card('远古巨龙', () => {
    const g = scenario().board(0, ['近战小兵']).hand(0, ['远古巨龙']).build();
    g.play('远古巨龙');
    const m = g.minion(0, '近战小兵');
    expect([m.attack, m.health]).toEqual([3, 4]);
    expect(g.minion(0, '远古巨龙').attack).toBe(8);
  });

  card('纳什男爵', () => {
    expectStats('纳什男爵', 10, 9, 9, ['taunt']);
    const g = scenario().board(0, ['纳什男爵', '近战小兵']).board(1, ['魔狼']).build();
    g.endTurn();
    expect(g.minion(0, '近战小兵').attack).toBe(2);
    expect(g.minion(0, '纳什男爵').attack).toBe(9);
    expect(g.minion(1, '魔狼').attack).toBe(3);
    g.endTurn(); // 对方回合结束不触发
    expect(g.minion(0, '近战小兵').attack).toBe(2);
  });
});

describe('德玛西亚', () => {
  card('召集', () => {
    const g = scenario().board(0, ['魔狼']).build();
    g.heroPower();
    expect(g.boardNames(0)).toEqual(['魔狼', '德玛西亚士兵']);
    expect(g.p(0).mana.current).toBe(8);
    expectIllegal(g.try({ kind: 'hero_power' })); // 每回合一次
    const g2 = scenario().mana(0, 1).build();
    expectIllegal(g2.try({ kind: 'hero_power' })); // 2 费
  });

  card('卢锡安', () => {
    expectStats('卢锡安', 2, 2, 1);
    const g = scenario().board(1, ['石甲虫']).hand(0, ['卢锡安']).build();
    g.play('卢锡安', { target: g.m(1, '石甲虫') });
    expect(g.minion(1, '石甲虫').keywords).toEqual([]);
  });

  card('薇恩', () => {
    expectStats('薇恩', 2, 1, 3, ['poisonous']);
    const g = scenario().board(0, ['薇恩']).board(1, ['超级兵']).build();
    g.attack(g.m(0, '薇恩'), g.m(1, '超级兵'));
    expect(g.has(1, '超级兵')).toBe(false);
  });

  card('波比', () => expectStats('波比', 3, 2, 3, ['taunt', 'divine_shield']));

  card('赵信', () => {
    expectStats('赵信', 3, 3, 2, ['charge']);
    const g = scenario().hand(0, ['赵信']).build();
    g.play('赵信');
    g.attack(g.m(0, '赵信'), g.hero(1));
    expect(g.p(1).hero.health).toBe(27);
  });

  card('奎因', () => {
    const g = scenario().board(0, ['近战小兵']).board(1, ['远程小兵']).hand(0, ['奎因']).build();
    g.play('奎因', { pos: 0 });
    expect(g.boardNames(0)).toEqual(['奎因', '瓦罗', '近战小兵']);
    const q = g.minion(0, '奎因');
    expect([q.attack, q.health]).toEqual([2, 2]);
    g.attack(g.m(0, '瓦罗'), g.m(1, '远程小兵'));
  });

  card('拉克丝', () => {
    const g = scenario().board(1, ['雷克塞']).hand(0, ['拉克丝']).build();
    const targets = g.legal().flatMap((a) => (a.kind === 'play_card' && a.target ? [a.target] : []));
    expect(targets.every((t) => t.kind === 'minion')).toBe(true);
    g.play('拉克丝', { target: g.m(1, '雷克塞') });
    expect(g.minion(1, '雷克塞').health).toBe(4);
    expect(g.minion(0, '拉克丝').attack).toBe(3);
  });

  card('菲奥娜', () => {
    expectStats('菲奥娜', 4, 3, 4);
    // 攻击时不受反击伤害
    const g = scenario().board(0, ['菲奥娜']).board(1, ['超级兵']).build();
    g.attack(g.m(0, '菲奥娜'), g.m(1, '超级兵'));
    expect(g.minion(0, '菲奥娜').health).toBe(4);
    expect(g.minion(1, '超级兵').health).toBe(3);
    // 剧毒随从的反击也没有伤害，所以不会死
    const g2 = scenario().board(0, ['菲奥娜']).board(1, ['薇恩']).build();
    g2.attack(g2.m(0, '菲奥娜'), g2.m(1, '薇恩'));
    expect(g2.has(0, '菲奥娜')).toBe(true);
    // 被攻击时照常受伤
    const g3 = scenario().board(0, ['魔狼']).board(1, ['菲奥娜']).build();
    g3.attack(g3.m(0, '魔狼'), g3.m(1, '菲奥娜'));
    expect(g3.minion(1, '菲奥娜').health).toBe(1);
  });

  card('娑娜', () => {
    expectStats('娑娜', 4, 2, 5);
    const g = scenario().board(0, ['娑娜', '近战小兵']).build();
    g.endTurn();
    const m = g.minion(0, '近战小兵');
    expect([m.attack, m.health]).toEqual([2, 3]);
    expect(g.minion(0, '娑娜').attack).toBe(2);
    const alone = scenario().board(0, ['娑娜']).build();
    alone.endTurn();
    expect(alone.minion(0, '娑娜').attack).toBe(2);
  });

  card('嘉文四世', () => {
    const g = scenario().hand(0, ['嘉文四世']).build();
    g.play('嘉文四世');
    expect(g.boardNames(0)).toEqual(['嘉文四世', '德玛西亚士兵', '德玛西亚士兵']);
    expect(g.minion(0, '嘉文四世').attack).toBe(3);
  });

  card('加里奥', () => expectStats('加里奥', 5, 3, 7, ['taunt']));

  card('凯尔', () => {
    const g = scenario().board(0, ['魔狼']).hand(0, ['凯尔']).build();
    g.play('凯尔', { target: g.m(0, '魔狼') });
    expect(g.minion(0, '魔狼').keywords).toContain('divine_shield');
    expect(g.minion(0, '凯尔').attack).toBe(5);
  });

  card('光盾', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['远程小兵']).hand(0, ['光盾']).build();
    expectIllegal(g.try(g.playAction('光盾', { target: g.m(1, '远程小兵') })));
    g.play('光盾', { target: g.m(0, '魔狼') });
    expect(g.minion(0, '魔狼').keywords).toContain('divine_shield');
    expect(g.p(0).mana.current).toBe(9);
  });

  card('铁誓', () => {
    const g = scenario().board(0, ['魔狼']).hand(0, ['铁誓']).build();
    g.play('铁誓', { target: g.m(0, '魔狼') });
    const m = g.minion(0, '魔狼');
    expect([m.attack, m.health, m.maxHealth]).toEqual([5, 4, 4]);
  });

  card('集结', () => {
    const g = scenario().board(0, ['魔狼', '近战小兵']).board(1, ['魔狼']).hand(0, ['集结']).build();
    g.play('集结');
    expect(g.p(0).board.map((m) => [m.attack, m.health])).toEqual([[4, 3], [2, 3]]);
    expect(g.minion(1, '魔狼').attack).toBe(3);
    expect(g.p(0).mana.current).toBe(7);
  });

  card('审判', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['魔狼', '雷克塞']).hand(0, ['审判']).build();
    g.play('审判');
    expect(g.boardNames(1)).toEqual(['雷克塞']);
    expect(g.minion(1, '雷克塞').health).toBe(4);
    expect(g.minion(0, '魔狼').health).toBe(2);
  });

  card('德玛西亚正义', () => {
    const g = scenario().board(1, ['泰达米尔']).hand(0, ['德玛西亚正义']).build();
    g.play('德玛西亚正义', { target: g.m(1, '泰达米尔') });
    expect(g.p(1).board).toHaveLength(0);
    expect(g.p(0).mana.current).toBe(5);
  });
});

describe('弗雷尔卓德', () => {
  card('寒冰箭', () => {
    const g = scenario().classes('freljord', 'demacia').board(1, ['魔狼']).build();
    g.heroPower(g.m(1, '魔狼'));
    expect(g.minion(1, '魔狼').frozenAt).toBe(5);
    const g2 = scenario().classes('freljord', 'demacia').board(0, ['魔狼']).build();
    expect(g2.legal().some((a) => a.kind === 'hero_power')).toBe(false);
  });

  card('奥拉夫', () => {
    expectStats('奥拉夫', 2, 2, 3);
    const g = scenario().board(0, ['奥拉夫']).hand(0, ['测试飞弹']).build();
    g.play('测试飞弹', { target: g.m(0, '奥拉夫') });
    expect(g.minion(0, '奥拉夫').attack).toBe(4);
  });

  card('乌迪尔', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const g = scenario().seed(seed).hand(0, ['乌迪尔']).build();
      g.play('乌迪尔');
      const m = g.minion(0, '乌迪尔');
      expect([m.attack, m.health]).toEqual([3, 3]);
      expect(m.keywords).toHaveLength(1);
      seen.add(m.keywords[0]);
    }
    expect([...seen].sort()).toEqual(['lifesteal', 'rush', 'taunt', 'windfury']);
  });

  card('布隆', () => expectStats('布隆', 4, 2, 7, ['taunt']));

  card('瑟庄妮', () => {
    const g = scenario().board(1, ['魔狼']).hand(0, ['瑟庄妮']).build();
    g.play('瑟庄妮', { target: g.m(1, '魔狼') });
    expect(g.minion(1, '魔狼').frozenAt).toBe(5);
    const m = g.minion(0, '瑟庄妮');
    expect([m.attack, m.health]).toEqual([4, 5]);
  });

  card('艾尼维亚', () => {
    expectStats('艾尼维亚', 5, 4, 4);
    const g = scenario().board(1, ['近战小兵', '艾尼维亚', '远程小兵']).hand(0, ['德玛西亚正义']).build();
    g.play('德玛西亚正义', { target: g.m(1, '艾尼维亚') });
    expect(g.boardNames(1)).toEqual(['近战小兵', '冰凤凰蛋', '远程小兵']);
  });

  card('努努和威朗普', () => expectStats('努努和威朗普', 5, 4, 6, ['rush']));

  card('泰达米尔', () => {
    expectStats('泰达米尔', 6, 6, 5);
    const g = scenario().board(1, ['泰达米尔']).board(0, [{ card: '超级兵', attack: 7 }, { card: '雷克塞', attack: 7 }]).build();
    g.attack(g.m(0, '超级兵'), g.m(1, '泰达米尔'));
    expect(g.minion(1, '泰达米尔').health).toBe(1);
    expect(g.eventsOf('damage').find((e) => e.target.kind === 'minion' && e.target.side === 1)?.lethalPrevented).toBe(true);
    // 只触发一次
    g.attack(g.m(0, '雷克塞'), g.m(1, '泰达米尔'));
    expect(g.has(1, '泰达米尔')).toBe(false);
    // 被沉默后不再生效
    const g2 = scenario().board(1, [{ card: '泰达米尔', silenced: true }]).board(0, [{ card: '超级兵', attack: 7 }]).build();
    g2.attack(g2.m(0, '超级兵'), g2.m(1, '泰达米尔'));
    expect(g2.has(1, '泰达米尔')).toBe(false);
  });

  card('特朗德尔', () => {
    const g = scenario().board(1, ['雷克塞']).hand(0, ['特朗德尔']).build();
    g.play('特朗德尔', { target: g.m(1, '雷克塞') });
    const enemy = g.minion(1, '雷克塞');
    expect([enemy.attack, enemy.health, enemy.maxHealth]).toEqual([1, 4, 4]);
    const self = g.minion(0, '特朗德尔');
    expect([self.attack, self.health, self.maxHealth]).toEqual([5, 7, 7]);
    // -2/-2 能直接减死
    const g2 = scenario().board(1, ['魔狼']).hand(0, ['特朗德尔']).build();
    g2.play('特朗德尔', { target: g2.m(1, '魔狼') });
    expect(g2.p(1).board).toHaveLength(0);
    // 没有敌方随从时战吼整个跳过，本随从也不加
    const g3 = scenario().hand(0, ['特朗德尔']).build();
    g3.play('特朗德尔');
    expect(g3.minion(0, '特朗德尔').attack).toBe(3);
  });

  card('奥恩', () => expectStats('奥恩', 6, 4, 7, ['taunt']));

  card('丽桑卓', () => {
    const g = scenario().board(0, ['魔狼']).board(1, ['魔狼', '卡兹克']).hand(0, ['丽桑卓']).build();
    g.play('丽桑卓');
    expect(g.p(1).board.every((m) => m.frozenAt === 5)).toBe(true);
    expect(g.minion(0, '魔狼').frozenAt).toBeUndefined();
    expect(g.minion(0, '丽桑卓').attack).toBe(5);
  });

  card('沃利贝尔', () => {
    const g = scenario().board(0, ['近战小兵']).board(1, ['远程小兵', '石甲虫']).hand(0, ['沃利贝尔']).build();
    g.play('沃利贝尔');
    expect(g.boardNames(1)).toEqual(['石甲虫']);
    expect(g.minion(0, '近战小兵').health).toBe(2);
    expect(g.minion(0, '沃利贝尔').maxHealth).toBe(7);
  });

  card('鹰击长空', () => {
    const g = scenario().hand(0, ['鹰击长空']).build();
    g.play('鹰击长空');
    expect(g.p(0).hand).toHaveLength(1);
    expect(g.p(0).mana.current).toBe(9);
  });

  card('凛冬将至', () => {
    const g = scenario().mana(0, 3, 3).hand(0, ['凛冬将至']).build();
    g.play('凛冬将至');
    expect(g.p(0).mana).toEqual({ max: 4, current: 1, temp: 0 });
  });

  card('冰川裂隙', () => {
    const g = scenario().board(1, ['魔狼', '石甲虫']).hand(0, ['冰川裂隙']).build();
    g.play('冰川裂隙');
    expect(g.p(1).board.map((m) => m.frozenAt)).toEqual([5, 5]);
    expect(g.p(0).mana.current).toBe(7);
  });

  card('魔法水晶箭', () => {
    const g = scenario().board(1, ['雷克塞']).hand(0, ['魔法水晶箭']).build();
    g.play('魔法水晶箭', { target: g.m(1, '雷克塞') });
    expect(g.minion(1, '雷克塞').health).toBe(3);
    expect(g.minion(1, '雷克塞').frozenAt).toBe(5);
    expect(g.p(0).mana.current).toBe(6);
  });

  card('暴风雪', () => {
    const g = scenario().board(1, ['雷克塞', '虚空幼虫']).hand(0, ['暴风雪']).build();
    g.play('暴风雪');
    expect(g.minion(1, '雷克塞').health).toBe(4);
    expect(g.minion(1, '雷克塞').frozenAt).toBe(5);
    // 被打死的随从在整个法术结算完才离场，亡语召唤的蠕虫不会被冻结
    expect(g.boardNames(1)).toEqual(['雷克塞', '虚空蠕虫', '虚空蠕虫']);
    expect(g.minion(1, '虚空蠕虫').frozenAt).toBeUndefined();
  });
});

describe('其他职业的英雄技能', () => {
  card('诺克萨斯断头台', () => {
    const g = scenario().classes('noxus', 'demacia').build();
    expect(g.legal().filter((a) => a.kind === 'hero_power')).toEqual([{ kind: 'hero_power' }]);
    g.heroPower();
    expect(g.p(1).hero.health).toBe(28);
  });

  card('灵魄', () => {
    const g = scenario().classes('ionia', 'demacia').board(1, ['魔狼']).build();
    g.heroPower(g.m(1, '魔狼'));
    expect(g.minion(1, '魔狼').health).toBe(1);
    expect(g.eventsOf('damage')[0].fx).toBe('shadow');
  });
});

describe('衍生物', () => {
  const tokenStats = (name: string, attack: number, health: number, keywords: Keyword[] = []) => {
    const g = scenario().board(0, [name]).build();
    const m = g.minion(0, name);
    expect([m.attack, m.health]).toEqual([attack, health]);
    expect(m.keywords).toEqual(keywords);
    expect(cardByName(name).token).toBe(true);
  };

  card('德玛西亚士兵', () => tokenStats('德玛西亚士兵', 1, 1));
  card('瓦罗', () => tokenStats('瓦罗', 1, 1, ['rush']));
  card('影分身', () => tokenStats('影分身', 1, 1, ['stealth']));
  card('失去坐骑的克烈', () => tokenStats('失去坐骑的克烈', 2, 1));
  card('亡骨赛恩', () => tokenStats('亡骨赛恩', 3, 2));
  card('松鼠', () => tokenStats('松鼠', 1, 1));
  card('虚空蠕虫', () => tokenStats('虚空蠕虫', 1, 1));

  card('冰凤凰蛋', () => {
    tokenStats('冰凤凰蛋', 0, 3);
    const g = scenario().board(0, ['近战小兵', '冰凤凰蛋']).current(1).turn(5, 1).build();
    g.endTurn();
    expect(g.boardNames(0)).toEqual(['近战小兵', '艾尼维亚']);
    expect(g.eventsOf('transform')[0].into).toBe('freljord.anivia');
    // 变回来的艾尼维亚这一回合不能攻击
    expect(g.legal().some((a) => a.kind === 'attack' && a.attacker.kind === 'minion' && a.attacker.instanceId === g.minion(0, '艾尼维亚').instanceId)).toBe(false);
    // 对手回合开始不变形
    const g2 = scenario().board(1, ['冰凤凰蛋']).current(1).turn(5, 1).build();
    g2.endTurn();
    expect(g2.has(1, '冰凤凰蛋')).toBe(true);
  });

  card('法力药水', () => {
    const g = scenario().mana(0, 2, 2).hand(0, ['法力药水']).build();
    expect(cardByName('法力药水').cost).toBe(0);
    g.play('法力药水');
    expect(g.p(0).mana).toEqual({ max: 2, current: 3, temp: 1 });
  });
});

describe('覆盖', () => {
  it('卡池里每张卡都有测试', () => {
    const missing = CARD_POOL.map((c) => c.id).filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
  });

  it('M1 卡池数量：中立 24、德玛西亚 16、弗雷尔卓德 16、英雄技能 4、衍生物 9', () => {
    const count = (pred: (c: (typeof CARD_POOL)[number]) => boolean) => CARD_POOL.filter(pred).length;
    expect(count((c) => c.class === 'neutral' && !c.token)).toBe(24);
    expect(count((c) => c.class === 'demacia' && !c.token)).toBe(16);
    expect(count((c) => c.class === 'freljord' && !c.token)).toBe(16);
    expect(count((c) => c.type === 'hero_power')).toBe(4);
    expect(count((c) => c.token === true && c.type !== 'hero_power')).toBe(9);
  });
});
