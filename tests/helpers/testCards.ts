// 测试专用卡：连击、回手、再次攻击等 M1 卡池里没有卡用到的机制（spec 7），以及几个边角动作和目标。
import type { CardDef } from '../../src/engine';

export const TEST_CARDS: CardDef[] = [
  {
    id: 'test.combo_buff', name: '测试连击随从', type: 'minion', class: 'neutral', cost: 1, attack: 2, health: 2,
    text: '连击：获得 +2 攻击力',
    effects: [{ trigger: 'combo', actions: [{ kind: 'buff', target: 'self', attack: 2, duration: 'permanent', fx: 'shadow' }] }],
  },
  {
    id: 'test.battlecry_and_combo', name: '测试战吼连击', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 1,
    text: '战吼：抽一张牌。连击：将一个敌方随从移回其拥有者的手牌',
    effects: [
      { trigger: 'battlecry', actions: [{ kind: 'draw', count: 1 }] },
      {
        trigger: 'combo', target: { pick: 'enemy_minion' },
        actions: [{ kind: 'bounce', target: 'chosen', fx: 'shadow' }],
      },
    ],
  },
  {
    id: 'test.bounce_spell', name: '测试回手', type: 'spell', class: 'neutral', cost: 1,
    text: '将一个随从移回其拥有者的手牌',
    effects: [{ trigger: 'cast', target: { pick: 'any_minion' }, actions: [{ kind: 'bounce', target: 'chosen', fx: 'shadow' }] }],
  },
  {
    id: 'test.extra_attacker', name: '测试再次攻击', type: 'minion', class: 'neutral', cost: 1, attack: 4, health: 4,
    text: '每当本随从消灭一个随从，便可以再次攻击',
    effects: [{ trigger: 'on_kill', actions: [{ kind: 'extra_attack', target: 'self' }] }],
  },
  {
    id: 'test.execute', name: '测试处决', type: 'spell', class: 'neutral', cost: 1,
    text: '消灭一个受伤的敌方随从',
    effects: [{
      trigger: 'cast', target: { pick: 'enemy_minion', where: { damaged: true } },
      actions: [{ kind: 'destroy', target: 'chosen', fx: 'physical' }],
    }],
  },
  {
    id: 'test.random_ping', name: '测试随机飞弹', type: 'spell', class: 'neutral', cost: 1,
    text: '对随机一个敌方随从造成 1 点伤害',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 1, target: 'random_enemy_minion', fx: 'fire' }] }],
  },
  {
    id: 'test.all_ping', name: '测试全场伤害', type: 'spell', class: 'neutral', cost: 1,
    text: '对所有随从造成 1 点伤害',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 1, target: 'all_minions', fx: 'fire' }] }],
  },
  {
    id: 'test.ping', name: '测试飞弹', type: 'spell', class: 'neutral', cost: 1,
    text: '造成 1 点伤害',
    effects: [{ trigger: 'cast', target: { pick: 'any_character' }, actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'fire' }] }],
  },
  {
    id: 'test.heal_spell', name: '测试治疗', type: 'spell', class: 'neutral', cost: 1,
    text: '恢复 3 点生命值',
    effects: [{ trigger: 'cast', target: { pick: 'any_character' }, actions: [{ kind: 'heal', amount: 3, target: 'chosen', fx: 'holy' }] }],
  },
  {
    id: 'test.shield_other', name: '测试护盾', type: 'minion', class: 'neutral', cost: 1, attack: 2, health: 2,
    text: '战吼：使另一个友方随从获得圣盾',
    effects: [{
      trigger: 'battlecry', target: { pick: 'other_friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', keywords: ['divine_shield'], duration: 'permanent', fx: 'holy' }],
    }],
  },
  {
    id: 'test.temp_buff', name: '测试血怒', type: 'spell', class: 'neutral', cost: 1,
    text: '使一个友方随从在本回合获得 +3 攻击力和潜行',
    effects: [{
      trigger: 'cast', target: { pick: 'friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', attack: 3, keywords: ['stealth'], duration: 'turn', fx: 'fire' }],
    }],
  },
  {
    id: 'test.windfury', name: '测试风怒', type: 'minion', class: 'neutral', cost: 1, attack: 2, health: 5,
    keywords: ['windfury'], text: '风怒',
  },
  {
    id: 'test.lifesteal', name: '测试吸血', type: 'minion', class: 'neutral', cost: 1, attack: 3, health: 3,
    keywords: ['lifesteal'], text: '吸血',
  },
  {
    id: 'test.enrage_full', name: '测试激怒', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 4,
    text: '激怒：+1/+1 并具有风怒',
    effects: [{ trigger: 'static', kind: 'enrage', attack: 1, health: 1, keywords: ['windfury'] }],
  },
  {
    id: 'test.poison_pinger', name: '测试毒针', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 1,
    keywords: ['poisonous'], text: '剧毒。战吼：造成 1 点伤害',
    effects: [{ trigger: 'battlecry', target: { pick: 'any_character' }, actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'physical' }] }],
  },
  {
    id: 'test.lifesteal_pinger', name: '测试吸血针', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 1,
    keywords: ['lifesteal'], text: '吸血。亡语：对敌方英雄造成 2 点伤害',
    effects: [{ trigger: 'deathrattle', actions: [{ kind: 'damage', amount: 2, target: 'enemy_hero', fx: 'physical' }] }],
  },
  {
    id: 'test.summon_spell', name: '测试召唤', type: 'spell', class: 'neutral', cost: 1,
    text: '召唤两个 1/1 的松鼠',
    effects: [{ trigger: 'cast', actions: [{ kind: 'summon', token: 'token.squirrel', count: 2, fx: 'holy' }] }],
  },
  {
    id: 'test.double_empty', name: '测试双空水晶', type: 'spell', class: 'neutral', cost: 0,
    text: '获得两个空的法力水晶',
    effects: [{ trigger: 'cast', actions: [{ kind: 'gain_mana', mode: 'empty', amount: 2 }] }],
  },
  {
    id: 'test.silence_all', name: '测试群体沉默', type: 'spell', class: 'neutral', cost: 1,
    text: '沉默所有随从',
    effects: [{ trigger: 'cast', actions: [{ kind: 'silence', target: 'all_minions', fx: 'holy' }] }],
  },
  {
    id: 'test.death_summoner', name: '测试亡语三连', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 1,
    text: '亡语：召唤三个 1/1 的松鼠',
    effects: [{ trigger: 'deathrattle', actions: [{ kind: 'summon', token: 'token.squirrel', count: 3, fx: 'holy' }] }],
  },
  {
    id: 'test.death_bomb', name: '测试亡语炸弹', type: 'minion', class: 'neutral', cost: 1, attack: 0, health: 1,
    text: '亡语：对所有随从造成 1 点伤害',
    effects: [{ trigger: 'deathrattle', actions: [{ kind: 'damage', amount: 1, target: 'all_minions', fx: 'fire' }] }],
  },
  {
    id: 'test.polymorph_drake', name: '测试变形', type: 'spell', class: 'neutral', cost: 1,
    text: '使一个随从变形为云端亚龙',
    effects: [{ trigger: 'cast', target: { pick: 'any_minion' }, actions: [{ kind: 'transform', target: 'chosen', into: 'neutral.cloud_drake', fx: 'holy' }] }],
  },
  {
    id: 'test.both_heroes_bomb', name: '测试双英雄炸弹', type: 'minion', class: 'neutral', cost: 1, attack: 0, health: 1,
    text: '亡语：对双方英雄各造成 1 点伤害',
    effects: [{
      trigger: 'deathrattle',
      actions: [
        { kind: 'damage', amount: 1, target: 'friendly_hero', fx: 'fire' },
        { kind: 'damage', amount: 1, target: 'enemy_hero', fx: 'fire' },
      ],
    }],
  },
  {
    id: 'test.turn_start_pinger', name: '测试回合开始', type: 'minion', class: 'neutral', cost: 1, attack: 0, health: 3,
    text: '在你的回合开始时，对敌方英雄造成 1 点伤害',
    effects: [{ trigger: 'turn_start', actions: [{ kind: 'damage', amount: 1, target: 'enemy_hero', fx: 'fire' }] }],
  },
  // fxId 透传（spec 3.4）：每张卡的动作都带 fxId 'test.spark'，覆盖会把 fx 写进事件的每种动作
  {
    id: 'test.fxid_multi', name: '测试特效组合', type: 'spell', class: 'neutral', cost: 1,
    text: '对一个随从依次：1 点伤害、治疗 1、+1/+1、冻结、沉默',
    effects: [{
      trigger: 'cast', target: { pick: 'any_minion' },
      actions: [
        { kind: 'damage', amount: 1, target: 'chosen', fx: 'fire', fxId: 'test.spark' },
        { kind: 'heal', amount: 1, target: 'chosen', fx: 'holy', fxId: 'test.spark' },
        { kind: 'buff', target: 'chosen', attack: 1, health: 1, duration: 'permanent', fx: 'holy', fxId: 'test.spark' },
        { kind: 'freeze', target: 'chosen', fx: 'frost', fxId: 'test.spark' },
        { kind: 'silence', target: 'chosen', fx: 'shadow', fxId: 'test.spark' },
      ],
    }],
  },
  {
    id: 'test.fxid_bounce', name: '测试特效回手', type: 'spell', class: 'neutral', cost: 1,
    text: '将一个随从移回手牌',
    effects: [{ trigger: 'cast', target: { pick: 'any_minion' }, actions: [{ kind: 'bounce', target: 'chosen', fx: 'shadow', fxId: 'test.spark' }] }],
  },
  {
    id: 'test.fxid_transform', name: '测试特效变形', type: 'spell', class: 'neutral', cost: 1,
    text: '将一个随从变成云龙',
    effects: [{
      trigger: 'cast', target: { pick: 'any_minion' },
      actions: [{ kind: 'transform', target: 'chosen', into: 'neutral.cloud_drake', fx: 'holy', fxId: 'test.spark' }],
    }],
  },
  {
    id: 'test.fxid_summon', name: '测试特效召唤', type: 'spell', class: 'neutral', cost: 1,
    text: '召唤一只虚空蠕虫',
    effects: [{ trigger: 'cast', actions: [{ kind: 'summon', token: 'token.void_worm', count: 1, fx: 'shadow', fxId: 'test.spark' }] }],
  },
  {
    id: 'test.fxid_destroy', name: '测试特效消灭', type: 'spell', class: 'neutral', cost: 1,
    text: '消灭一个随从',
    effects: [{ trigger: 'cast', target: { pick: 'any_minion' }, actions: [{ kind: 'destroy', target: 'chosen', fx: 'physical', fxId: 'test.spark' }] }],
  },
];
