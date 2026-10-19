// 艾欧尼亚。M1 只有英雄技能，职业卡留到 M2。
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
];
