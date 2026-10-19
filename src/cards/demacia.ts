// 德玛西亚（cards-v1.md「德玛西亚」）。
import type { CardDef } from '../engine/state';

export const DEMACIA_CARDS: CardDef[] = [
  {
    id: 'demacia.hero_power', name: '召集', type: 'hero_power', class: 'demacia', cost: 2, token: true,
    text: '召唤一个 1/1 的德玛西亚士兵',
    effects: [{ trigger: 'cast', actions: [{ kind: 'summon', token: 'token.demacian_soldier', count: 1, fx: 'holy' }] }],
  },
  {
    id: 'demacia.lucian', name: '卢锡安', type: 'minion', class: 'demacia', cost: 2, attack: 2, health: 1,
    text: '战吼：沉默一个随从', champion: 'Lucian',
    effects: [{
      trigger: 'battlecry', target: { pick: 'any_minion' },
      actions: [{ kind: 'silence', target: 'chosen', fx: 'holy' }],
    }],
  },
  {
    id: 'demacia.vayne', name: '薇恩', type: 'minion', class: 'demacia', cost: 2, attack: 2, health: 1,
    keywords: ['poisonous'], text: '剧毒', champion: 'Vayne',
  },
  {
    id: 'demacia.poppy', name: '波比', type: 'minion', class: 'demacia', cost: 3, attack: 1, health: 4,
    keywords: ['taunt', 'divine_shield'], text: '嘲讽，圣盾', champion: 'Poppy',
  },
  {
    id: 'demacia.xinzhao', name: '赵信', type: 'minion', class: 'demacia', cost: 3, attack: 3, health: 2,
    keywords: ['charge'], text: '冲锋', champion: 'XinZhao',
  },
  {
    id: 'demacia.quinn', name: '奎因', type: 'minion', class: 'demacia', cost: 3, attack: 3, health: 2,
    text: '战吼：召唤一个 1/1 并具有突袭的瓦罗', champion: 'Quinn',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'summon', token: 'token.valor', count: 1, fx: 'physical' }] }],
  },
  {
    id: 'demacia.lux', name: '拉克丝', type: 'minion', class: 'demacia', cost: 4, attack: 3, health: 3,
    text: '战吼：对一个随从造成 2 点伤害', champion: 'Lux',
    effects: [{
      trigger: 'battlecry', target: { pick: 'any_minion' },
      actions: [{ kind: 'damage', amount: 2, target: 'chosen', fx: 'holy' }],
    }],
  },
  {
    id: 'demacia.fiora', name: '菲奥娜', type: 'minion', class: 'demacia', cost: 4, attack: 4, health: 3,
    text: '决斗：本随从攻击时不受反击伤害', champion: 'Fiora', script: 'fiora_duel',
  },
  {
    id: 'demacia.sona', name: '娑娜', type: 'minion', class: 'demacia', cost: 4, attack: 2, health: 5,
    text: '在你的回合结束时，使随机一个其他友方随从获得 +1/+1', champion: 'Sona',
    effects: [{
      trigger: 'turn_end',
      actions: [{ kind: 'buff', target: 'random_other_friendly_minion', attack: 1, health: 1, duration: 'permanent', fx: 'holy' }],
    }],
  },
  {
    id: 'demacia.jarvaniv', name: '嘉文四世', type: 'minion', class: 'demacia', cost: 5, attack: 3, health: 4,
    text: '战吼：召唤两个 1/1 的德玛西亚士兵', champion: 'JarvanIV',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'summon', token: 'token.demacian_soldier', count: 2, fx: 'holy' }] }],
  },
  {
    id: 'demacia.galio', name: '加里奥', type: 'minion', class: 'demacia', cost: 5, attack: 3, health: 7,
    keywords: ['taunt'], text: '嘲讽', champion: 'Galio',
  },
  {
    id: 'demacia.kayle', name: '凯尔', type: 'minion', class: 'demacia', cost: 6, attack: 6, health: 4,
    text: '战吼：使一个友方随从获得圣盾', champion: 'Kayle',
    effects: [{
      trigger: 'battlecry', target: { pick: 'friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', keywords: ['divine_shield'], duration: 'permanent', fx: 'holy' }],
    }],
  },
  {
    id: 'demacia.light_shield', name: '光盾', type: 'spell', class: 'demacia', cost: 1,
    text: '使一个友方随从获得圣盾',
    effects: [{
      trigger: 'cast', target: { pick: 'friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', keywords: ['divine_shield'], duration: 'permanent', fx: 'holy' }],
    }],
  },
  {
    id: 'demacia.iron_oath', name: '铁誓', type: 'spell', class: 'demacia', cost: 2,
    text: '使一个友方随从获得 +2/+2',
    effects: [{
      trigger: 'cast', target: { pick: 'friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', attack: 2, health: 2, duration: 'permanent', fx: 'holy' }],
    }],
  },
  {
    id: 'demacia.rally', name: '集结', type: 'spell', class: 'demacia', cost: 3,
    text: '使所有友方随从获得 +1/+1',
    // 法术没有"本随从"，other_friendly_minions 就是所有友方随从
    effects: [{
      trigger: 'cast',
      actions: [{ kind: 'buff', target: 'other_friendly_minions', attack: 1, health: 1, duration: 'permanent', fx: 'holy' }],
    }],
  },
  {
    id: 'demacia.judgment', name: '审判', type: 'spell', class: 'demacia', cost: 4,
    text: '对所有敌方随从造成 2 点伤害',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 2, target: 'all_enemy_minions', fx: 'physical', fxId: 'garen.judgment' }] }],
  },
  {
    id: 'demacia.demacian_justice', name: '德玛西亚正义', type: 'spell', class: 'demacia', cost: 5,
    text: '消灭一个敌方随从',
    effects: [{
      trigger: 'cast', target: { pick: 'enemy_minion' },
      actions: [{ kind: 'destroy', target: 'chosen', fx: 'holy', fxId: 'garen.demacian_justice' }],
    }],
  },
];
