// 诺克萨斯（cards-v1.md「诺克萨斯」）。
import type { CardDef } from '../engine/state';

export const NOXUS_CARDS: CardDef[] = [
  {
    id: 'noxus.hero_power', name: '诺克萨斯断头台', type: 'hero_power', class: 'noxus', cost: 2, token: true,
    text: '对敌方英雄造成 2 点伤害',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 2, target: 'enemy_hero', fx: 'physical' }] }],
  },
  {
    id: 'noxus.annie', name: '安妮', type: 'minion', class: 'noxus', cost: 2, attack: 1, health: 2,
    text: '战吼：对一个随从造成 1 点伤害', champion: 'Annie',
    effects: [{
      trigger: 'battlecry', target: { pick: 'any_minion' },
      actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'fire' }],
    }],
  },
  {
    id: 'noxus.kled', name: '克烈', type: 'minion', class: 'noxus', cost: 3, attack: 3, health: 2,
    text: '亡语：召唤一个 2/1 的失去坐骑的克烈', champion: 'Kled',
    effects: [{ trigger: 'deathrattle', actions: [{ kind: 'summon', token: 'token.kled_dismounted', count: 1, fx: 'physical' }] }],
  },
  {
    id: 'noxus.talon', name: '泰隆', type: 'minion', class: 'noxus', cost: 3, attack: 4, health: 2,
    keywords: ['stealth'], text: '潜行', champion: 'Talon',
  },
  {
    id: 'noxus.draven', name: '德莱文', type: 'minion', class: 'noxus', cost: 4, attack: 4, health: 2,
    keywords: ['windfury'], text: '风怒', champion: 'Draven',
  },
  {
    id: 'noxus.katarina', name: '卡特琳娜', type: 'minion', class: 'noxus', cost: 4, attack: 4, health: 2,
    text: '战吼：对所有敌方随从造成 1 点伤害', champion: 'Katarina',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'damage', amount: 1, target: 'all_enemy_minions', fx: 'physical', fxId: 'katarina.death_lotus' }] }],
  },
  {
    id: 'noxus.vladimir', name: '弗拉基米尔', type: 'minion', class: 'noxus', cost: 5, attack: 4, health: 4,
    keywords: ['lifesteal'], text: '吸血', champion: 'Vladimir',
  },
  {
    id: 'noxus.samira', name: '莎弥拉', type: 'minion', class: 'noxus', cost: 5, attack: 6, health: 4,
    keywords: ['rush'], text: '突袭', champion: 'Samira',
  },
  {
    id: 'noxus.sion', name: '赛恩', type: 'minion', class: 'noxus', cost: 6, attack: 3, health: 7,
    keywords: ['taunt'], text: '嘲讽。亡语：召唤一个 3/2 的亡骨赛恩', champion: 'Sion',
    effects: [{ trigger: 'deathrattle', actions: [{ kind: 'summon', token: 'token.sion_undead', count: 1, fx: 'shadow' }] }],
  },
  {
    id: 'noxus.swain', name: '斯维因', type: 'minion', class: 'noxus', cost: 6, attack: 4, health: 5,
    text: '在你的回合结束时，对所有敌方随从造成 1 点伤害', champion: 'Swain',
    effects: [{ trigger: 'turn_end', actions: [{ kind: 'damage', amount: 1, target: 'all_enemy_minions', fx: 'shadow' }] }],
  },
  {
    id: 'noxus.flying_axe', name: '飞斧', type: 'spell', class: 'noxus', cost: 1,
    text: '造成 2 点伤害',
    effects: [{
      trigger: 'cast', target: { pick: 'any_character' },
      actions: [{ kind: 'damage', amount: 2, target: 'chosen', fx: 'physical' }],
    }],
  },
  {
    id: 'noxus.blood_rage', name: '血怒', type: 'spell', class: 'noxus', cost: 2,
    text: '使一个友方随从在本回合获得 +3 攻击力',
    effects: [{
      trigger: 'cast', target: { pick: 'friendly_minion' },
      actions: [{ kind: 'buff', target: 'chosen', attack: 3, duration: 'turn', fx: 'fire' }],
    }],
  },
  {
    id: 'noxus.execute', name: '处决', type: 'spell', class: 'noxus', cost: 2,
    text: '消灭一个受伤的敌方随从',
    effects: [{
      trigger: 'cast', target: { pick: 'enemy_minion', where: { damaged: true } },
      actions: [{ kind: 'destroy', target: 'chosen', fx: 'physical' }],
    }],
  },
  {
    id: 'noxus.decimate', name: '大杀四方', type: 'spell', class: 'noxus', cost: 2,
    text: '对所有敌方随从造成 1 点伤害',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 1, target: 'all_enemy_minions', fx: 'physical' }] }],
  },
  {
    id: 'noxus.might_of_noxus', name: '诺克萨斯之力', type: 'spell', class: 'noxus', cost: 4,
    text: '造成 4 点伤害',
    effects: [{
      trigger: 'cast', target: { pick: 'any_character' },
      actions: [{ kind: 'damage', amount: 4, target: 'chosen', fx: 'fire' }],
    }],
  },
];
