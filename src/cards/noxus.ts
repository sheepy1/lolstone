// 诺克萨斯。M1 只有英雄技能，职业卡留到 M2。
import type { CardDef } from '../engine/state';

export const NOXUS_CARDS: CardDef[] = [
  {
    id: 'noxus.hero_power', name: '诺克萨斯断头台', type: 'hero_power', class: 'noxus', cost: 2, token: true,
    text: '对敌方英雄造成 2 点伤害',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 2, target: 'enemy_hero', fx: 'physical' }] }],
  },
];
