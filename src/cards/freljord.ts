// 弗雷尔卓德（cards-v1.md「弗雷尔卓德」）。
import type { CardDef } from '../engine/state';

export const FRELJORD_CARDS: CardDef[] = [
  {
    id: 'freljord.hero_power', name: '寒冰箭', type: 'hero_power', class: 'freljord', cost: 2, token: true,
    text: '冻结一个敌方随从',
    effects: [{
      trigger: 'cast', target: { pick: 'enemy_minion' },
      actions: [{ kind: 'freeze', target: 'chosen', fx: 'frost' }],
    }],
  },
  {
    id: 'freljord.olaf', name: '奥拉夫', type: 'minion', class: 'freljord', cost: 2, attack: 2, health: 3,
    text: '激怒：+2 攻击力', champion: 'Olaf',
    effects: [{ trigger: 'static', kind: 'enrage', attack: 2 }],
  },
  {
    id: 'freljord.udyr', name: '乌迪尔', type: 'minion', class: 'freljord', cost: 3, attack: 3, health: 3,
    text: '战吼：随机获得以下关键词之一：嘲讽、风怒、突袭、吸血', champion: 'Udyr',
    effects: [{
      trigger: 'battlecry',
      actions: [{ kind: 'random_keyword', target: 'self', from: ['taunt', 'windfury', 'rush', 'lifesteal'] }],
    }],
  },
  {
    id: 'freljord.braum', name: '布隆', type: 'minion', class: 'freljord', cost: 4, attack: 2, health: 7,
    keywords: ['taunt'], text: '嘲讽', champion: 'Braum',
  },
  {
    id: 'freljord.sejuani', name: '瑟庄妮', type: 'minion', class: 'freljord', cost: 5, attack: 4, health: 5,
    text: '战吼：冻结一个敌方随从', champion: 'Sejuani',
    effects: [{
      trigger: 'battlecry', target: { pick: 'enemy_minion' },
      actions: [{ kind: 'freeze', target: 'chosen', fx: 'frost' }],
    }],
  },
  {
    id: 'freljord.anivia', name: '艾尼维亚', type: 'minion', class: 'freljord', cost: 5, attack: 4, health: 4,
    text: '亡语：召唤一个 0/3 的冰凤凰蛋', champion: 'Anivia',
    effects: [{ trigger: 'deathrattle', actions: [{ kind: 'summon', token: 'token.anivia_egg', count: 1, fx: 'frost' }] }],
  },
  {
    id: 'freljord.nunu', name: '努努和威朗普', type: 'minion', class: 'freljord', cost: 5, attack: 4, health: 6,
    keywords: ['rush'], text: '突袭', champion: 'Nunu',
  },
  {
    id: 'freljord.tryndamere', name: '泰达米尔', type: 'minion', class: 'freljord', cost: 6, attack: 6, health: 5,
    text: '无尽怒火：第一次受到致命伤害时，生命值变为 1 而不是死亡', champion: 'Tryndamere',
    script: 'tryndamere_undying',
  },
  {
    id: 'freljord.trundle', name: '特朗德尔', type: 'minion', class: 'freljord', cost: 6, attack: 3, health: 5,
    text: '战吼：使一个敌方随从获得 -2/-2，本随从获得 +2/+2', champion: 'Trundle',
    effects: [{
      trigger: 'battlecry', target: { pick: 'enemy_minion' },
      actions: [
        { kind: 'buff', target: 'chosen', attack: -2, health: -2, duration: 'permanent', fx: 'frost' },
        { kind: 'buff', target: 'self', attack: 2, health: 2, duration: 'permanent', fx: 'frost' },
      ],
    }],
  },
  {
    id: 'freljord.ornn', name: '奥恩', type: 'minion', class: 'freljord', cost: 6, attack: 4, health: 7,
    keywords: ['taunt'], text: '嘲讽', champion: 'Ornn',
  },
  {
    id: 'freljord.lissandra', name: '丽桑卓', type: 'minion', class: 'freljord', cost: 7, attack: 5, health: 5,
    text: '战吼：冻结所有敌方随从', champion: 'Lissandra',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'freeze', target: 'all_enemy_minions', fx: 'frost' }] }],
  },
  {
    id: 'freljord.volibear', name: '沃利贝尔', type: 'minion', class: 'freljord', cost: 7, attack: 6, health: 7,
    text: '战吼：对所有敌方随从造成 1 点伤害', champion: 'Volibear',
    effects: [{ trigger: 'battlecry', actions: [{ kind: 'damage', amount: 1, target: 'all_enemy_minions', fx: 'physical' }] }],
  },
  {
    id: 'freljord.hawkshot', name: '鹰击长空', type: 'spell', class: 'freljord', cost: 1,
    text: '抽一张牌',
    effects: [{ trigger: 'cast', actions: [{ kind: 'draw', count: 1 }] }],
  },
  {
    id: 'freljord.winters_approach', name: '凛冬将至', type: 'spell', class: 'freljord', cost: 2,
    text: '获得一个空的法力水晶',
    effects: [{ trigger: 'cast', actions: [{ kind: 'gain_mana', mode: 'empty', amount: 1 }] }],
  },
  {
    id: 'freljord.glacial_fissure', name: '冰川裂隙', type: 'spell', class: 'freljord', cost: 3,
    text: '冻结所有敌方随从',
    effects: [{ trigger: 'cast', actions: [{ kind: 'freeze', target: 'all_enemy_minions', fx: 'frost' }] }],
  },
  {
    id: 'freljord.crystal_arrow', name: '魔法水晶箭', type: 'spell', class: 'freljord', cost: 4,
    text: '造成 3 点伤害并冻结目标',
    effects: [{
      trigger: 'cast', target: { pick: 'any_character' },
      actions: [
        { kind: 'damage', amount: 3, target: 'chosen', fx: 'frost' },
        { kind: 'freeze', target: 'chosen', fx: 'frost' },
      ],
    }],
  },
  {
    id: 'freljord.blizzard', name: '暴风雪', type: 'spell', class: 'freljord', cost: 6,
    text: '对所有敌方随从造成 2 点伤害并冻结它们',
    effects: [{
      trigger: 'cast',
      actions: [
        { kind: 'damage', amount: 2, target: 'all_enemy_minions', fx: 'frost' },
        { kind: 'freeze', target: 'all_enemy_minions', fx: 'frost' },
      ],
    }],
  },
];
