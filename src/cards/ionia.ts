// 艾欧尼亚（cards-v1.md「艾欧尼亚」）。
import type { CardDef } from '../engine/state';

export const IONIA_CARDS: CardDef[] = [
  {
    id: 'ionia.hero_power', name: '灵魄', type: 'hero_power', class: 'ionia', cost: 2, token: true,
    text: '造成 1 点伤害',
    effects: [{
      trigger: 'cast', target: { pick: 'any_character' },
      actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'shadow' }],
    }],
  },
  {
    id: 'ionia.kennen', name: '凯南', type: 'minion', class: 'ionia', cost: 2, attack: 2, health: 3,
    text: '法术伤害 +1', champion: 'Kennen',
    effects: [{ trigger: 'static', kind: 'spell_damage', amount: 1 }],
  },
  {
    id: 'ionia.akali', name: '阿卡丽', type: 'minion', class: 'ionia', cost: 3, attack: 2, health: 3,
    keywords: ['stealth'], text: '潜行。连击：获得 +2 攻击力', champion: 'Akali',
    effects: [{ trigger: 'combo', actions: [{ kind: 'buff', target: 'self', attack: 2, duration: 'permanent', fx: 'shadow' }] }],
  },
  {
    id: 'ionia.karma', name: '卡尔玛', type: 'minion', class: 'ionia', cost: 3, attack: 2, health: 3,
    text: '战吼：抽一张牌', champion: 'Karma',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'draw', count: 1 }] }],
  },
  {
    id: 'ionia.zed', name: '劫', type: 'minion', class: 'ionia', cost: 4, attack: 3, health: 2,
    keywords: ['stealth'], text: '潜行。战吼：召唤一个 1/1 并具有潜行的影分身', champion: 'Zed',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'summon', token: 'token.zed_shadow', count: 1, fx: 'shadow' }] }],
  },
  {
    id: 'ionia.yasuo', name: '亚索', type: 'minion', class: 'ionia', cost: 4, attack: 4, health: 3,
    keywords: ['divine_shield'], text: '圣盾', champion: 'Yasuo',
  },
  {
    id: 'ionia.leesin', name: '李青', type: 'minion', class: 'ionia', cost: 4, attack: 3, health: 3,
    text: '连击：将一个敌方随从移回其拥有者的手牌', champion: 'LeeSin',
    effects: [{
      trigger: 'combo', target: { pick: 'enemy_minion' },
      actions: [{ kind: 'bounce', target: 'chosen', fx: 'physical' }],
    }],
  },
  {
    id: 'ionia.shen', name: '慎', type: 'minion', class: 'ionia', cost: 4, attack: 2, health: 5,
    keywords: ['taunt'], text: '嘲讽。战吼：使另一个友方随从获得圣盾', champion: 'Shen',
    effects: [{
      trigger: 'battlecry', target: { pick: 'other_friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', keywords: ['divine_shield'], duration: 'permanent', fx: 'holy' }],
    }],
  },
  {
    id: 'ionia.irelia', name: '艾瑞莉娅', type: 'minion', class: 'ionia', cost: 4, attack: 3, health: 4,
    keywords: ['rush'], text: '突袭', champion: 'Irelia',
  },
  {
    id: 'ionia.masteryi', name: '易', type: 'minion', class: 'ionia', cost: 5, attack: 4, health: 4,
    text: '每当本随从消灭一个随从，便可以再次攻击', champion: 'MasterYi',
    effects: [{ trigger: 'on_kill', actions: [{ kind: 'extra_attack', target: 'self' }] }],
  },
  {
    id: 'ionia.yone', name: '永恩', type: 'minion', class: 'ionia', cost: 5, attack: 4, health: 5,
    text: '战吼：对一个敌方随从造成 2 点伤害', champion: 'Yone',
    effects: [{
      trigger: 'battlecry', target: { pick: 'enemy_minion' },
      actions: [{ kind: 'damage', amount: 2, target: 'chosen', fx: 'shadow' }],
    }],
  },
  {
    id: 'ionia.syndra', name: '辛德拉', type: 'minion', class: 'ionia', cost: 6, attack: 4, health: 5,
    text: '法术伤害 +1。战吼：造成 3 点伤害', champion: 'Syndra',
    effects: [
      { trigger: 'static', kind: 'spell_damage', amount: 1 },
      {
        trigger: 'battlecry', target: { pick: 'any_character' },
        actions: [{ kind: 'damage', amount: 3, target: 'chosen', fx: 'shadow' }],
      },
    ],
  },
  {
    id: 'ionia.ghostblade', name: '鬼切', type: 'spell', class: 'ionia', cost: 1,
    text: '使一个友方随从获得潜行',
    effects: [{
      trigger: 'cast', target: { pick: 'friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', keywords: ['stealth'], duration: 'permanent', fx: 'shadow' }],
    }],
  },
  {
    id: 'ionia.recall', name: '传送回城', type: 'spell', class: 'ionia', cost: 1,
    text: '将一个友方随从移回你的手牌',
    effects: [{
      trigger: 'cast', target: { pick: 'friendly_minion' },
      actions: [{ kind: 'bounce', target: 'chosen', fx: 'holy' }],
    }],
  },
  {
    id: 'ionia.spirit_rush', name: '灵魄突袭', type: 'spell', class: 'ionia', cost: 2,
    text: '对一个随从造成 3 点伤害',
    effects: [{
      trigger: 'cast', target: { pick: 'any_minion' },
      actions: [{ kind: 'damage', amount: 3, target: 'chosen', fx: 'shadow' }],
    }],
  },
  {
    id: 'ionia.meditate', name: '冥想', type: 'spell', class: 'ionia', cost: 3,
    text: '抽两张牌',
    effects: [{ trigger: 'cast', actions: [{ kind: 'draw', count: 2 }] }],
  },
  {
    id: 'ionia.last_breath', name: '狂风绝息斩', type: 'spell', class: 'ionia', cost: 6,
    text: '对所有敌方随从造成 3 点伤害',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 3, target: 'all_enemy_minions', fx: 'physical' }] }],
  },
];
