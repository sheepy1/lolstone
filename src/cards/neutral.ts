// 中立卡（cards-v1.md「中立」）。
import type { CardDef } from '../engine/state';

export const NEUTRAL_CARDS: CardDef[] = [
  { id: 'neutral.melee_minion', name: '近战小兵', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 2, text: '' },
  { id: 'neutral.caster_minion', name: '远程小兵', type: 'minion', class: 'neutral', cost: 1, attack: 2, health: 1, text: '' },
  {
    id: 'neutral.teemo', name: '提莫', type: 'minion', class: 'neutral', cost: 2, attack: 1, health: 1,
    keywords: ['stealth', 'poisonous'], text: '潜行，剧毒', champion: 'Teemo',
  },
  {
    id: 'neutral.rift_scuttler', name: '迅捷蟹', type: 'minion', class: 'neutral', cost: 2, attack: 2, health: 1,
    text: '亡语：抽一张牌',
    effects: [{ trigger: 'deathrattle', actions: [{ kind: 'draw', count: 1 }] }],
  },
  {
    id: 'neutral.ancient_krug', name: '石甲虫', type: 'minion', class: 'neutral', cost: 2, attack: 1, health: 4,
    keywords: ['taunt'], text: '嘲讽',
  },
  { id: 'neutral.murk_wolf', name: '魔狼', type: 'minion', class: 'neutral', cost: 2, attack: 3, health: 2, text: '' },
  {
    id: 'neutral.void_larva', name: '虚空幼虫', type: 'minion', class: 'neutral', cost: 2, attack: 1, health: 2,
    text: '亡语：召唤两个 1/1 的虚空蠕虫',
    effects: [{ trigger: 'deathrattle', actions: [{ kind: 'summon', token: 'token.void_worm', count: 2, fx: 'shadow' }] }],
  },
  {
    id: 'neutral.gromp', name: '魔沼蛙', type: 'minion', class: 'neutral', cost: 3, attack: 2, health: 3,
    keywords: ['poisonous'], text: '剧毒',
  },
  {
    id: 'neutral.blue_sentinel', name: '蓝色哨兵', type: 'minion', class: 'neutral', cost: 3, attack: 2, health: 4,
    text: '法术伤害 +1',
    effects: [{ trigger: 'static', kind: 'spell_damage', amount: 1 }],
  },
  {
    id: 'neutral.lulu', name: '璐璐', type: 'minion', class: 'neutral', cost: 4, attack: 2, health: 3,
    text: '战吼：使一个随从变形为 1/1 的松鼠', champion: 'Lulu',
    effects: [{
      trigger: 'battlecry', target: { pick: 'any_minion' },
      actions: [{ kind: 'transform', target: 'chosen', into: 'token.squirrel', fx: 'holy' }],
    }],
  },
  {
    id: 'neutral.khazix', name: '卡兹克', type: 'minion', class: 'neutral', cost: 4, attack: 4, health: 3,
    keywords: ['stealth'], text: '潜行', champion: 'Khazix',
  },
  {
    id: 'neutral.siege_minion', name: '炮车', type: 'minion', class: 'neutral', cost: 4, attack: 3, health: 3,
    keywords: ['rush'], text: '突袭',
  },
  {
    id: 'neutral.red_brambleback', name: '猩红印记', type: 'minion', class: 'neutral', cost: 4, attack: 3, health: 4,
    text: '战吼：使一个友方随从获得 +2 攻击力',
    effects: [{
      trigger: 'battlecry', target: { pick: 'friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', attack: 2, duration: 'permanent', fx: 'fire' }],
    }],
  },
  {
    id: 'neutral.reksai', name: '雷克塞', type: 'minion', class: 'neutral', cost: 5, attack: 4, health: 5,
    keywords: ['rush'], text: '突袭', champion: 'RekSai',
  },
  {
    id: 'neutral.rift_herald', name: '峡谷先锋', type: 'minion', class: 'neutral', cost: 5, attack: 5, health: 4,
    keywords: ['rush'], text: '突袭',
  },
  {
    id: 'neutral.velkoz', name: '维克兹', type: 'minion', class: 'neutral', cost: 5, attack: 3, health: 4,
    text: '法术伤害 +1。战吼：造成 2 点伤害', champion: 'Velkoz',
    effects: [
      { trigger: 'static', kind: 'spell_damage', amount: 1 },
      {
        trigger: 'battlecry', target: { pick: 'any_character' },
        actions: [{ kind: 'damage', amount: 2, target: 'chosen', fx: 'shadow' }],
      },
    ],
  },
  {
    id: 'neutral.infernal_drake', name: '炼狱亚龙', type: 'minion', class: 'neutral', cost: 5, attack: 4, health: 5,
    text: '战吼：使其他所有友方随从获得 +1 攻击力',
    effects: [{
      trigger: 'battlecry',
      actions: [{ kind: 'buff', target: 'other_friendly_minions', attack: 1, duration: 'permanent', fx: 'fire' }],
    }],
  },
  {
    id: 'neutral.mountain_drake', name: '山脉亚龙', type: 'minion', class: 'neutral', cost: 5, attack: 4, health: 5,
    text: '战吼：使其他所有友方随从获得 +1 生命值',
    effects: [{
      trigger: 'battlecry',
      actions: [{ kind: 'buff', target: 'other_friendly_minions', health: 1, duration: 'permanent', fx: 'physical' }],
    }],
  },
  {
    id: 'neutral.ocean_drake', name: '海洋亚龙', type: 'minion', class: 'neutral', cost: 5, attack: 4, health: 5,
    text: '战吼：为你的英雄恢复 4 点生命值',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'heal', amount: 4, target: 'friendly_hero', fx: 'holy' }] }],
  },
  {
    id: 'neutral.cloud_drake', name: '云端亚龙', type: 'minion', class: 'neutral', cost: 5, attack: 4, health: 5,
    text: '战吼：抽一张牌',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'draw', count: 1 }] }],
  },
  {
    id: 'neutral.chogath', name: '科加斯', type: 'minion', class: 'neutral', cost: 6, attack: 4, health: 7,
    text: '每当本随从消灭一个随从，便获得 +1/+1', champion: 'Chogath',
    effects: [{
      trigger: 'on_kill',
      actions: [{ kind: 'buff', target: 'self', attack: 1, health: 1, duration: 'permanent', fx: 'shadow' }],
    }],
  },
  {
    id: 'neutral.super_minion', name: '超级兵', type: 'minion', class: 'neutral', cost: 6, attack: 5, health: 6,
    keywords: ['taunt'], text: '嘲讽',
  },
  {
    id: 'neutral.elder_dragon', name: '远古巨龙', type: 'minion', class: 'neutral', cost: 9, attack: 8, health: 8,
    text: '战吼：使其他所有友方随从获得 +2/+2',
    effects: [{
      trigger: 'battlecry',
      actions: [{ kind: 'buff', target: 'other_friendly_minions', attack: 2, health: 2, duration: 'permanent', fx: 'fire' }],
    }],
  },
  {
    id: 'neutral.baron_nashor', name: '纳什男爵', type: 'minion', class: 'neutral', cost: 10, attack: 9, health: 9,
    keywords: ['taunt'], text: '嘲讽。在你的回合结束时，使其他所有友方随从获得 +1/+1',
    effects: [{
      trigger: 'turn_end',
      actions: [{ kind: 'buff', target: 'other_friendly_minions', attack: 1, health: 1, duration: 'permanent', fx: 'shadow', fxId: 'baron.hand_of_baron' }],
    }],
  },
];
