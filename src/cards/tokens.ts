// 衍生物（cards-v1.md「衍生物」）。全部 token: true，不能放进牌库。
import type { CardDef } from '../engine/state';

export const TOKEN_CARDS: CardDef[] = [
  { id: 'token.demacian_soldier', name: '德玛西亚士兵', type: 'minion', class: 'demacia', cost: 1, attack: 1, health: 1, text: '', token: true },
  {
    id: 'token.valor', name: '瓦罗', type: 'minion', class: 'demacia', cost: 1, attack: 1, health: 1,
    keywords: ['rush'], text: '突袭', token: true,
  },
  {
    id: 'token.zed_shadow', name: '影分身', type: 'minion', class: 'ionia', cost: 1, attack: 1, health: 1,
    keywords: ['stealth'], text: '潜行', token: true,
  },
  { id: 'token.kled_dismounted', name: '失去坐骑的克烈', type: 'minion', class: 'noxus', cost: 1, attack: 2, health: 1, text: '', token: true },
  { id: 'token.sion_undead', name: '亡骨赛恩', type: 'minion', class: 'noxus', cost: 3, attack: 3, health: 2, text: '', token: true },
  {
    id: 'token.anivia_egg', name: '冰凤凰蛋', type: 'minion', class: 'freljord', cost: 0, attack: 0, health: 3,
    text: '在你的回合开始时，变形为艾尼维亚', token: true,
    effects: [{ trigger: 'turn_start', actions: [{ kind: 'transform', target: 'self', into: 'freljord.anivia', fx: 'frost' }] }],
  },
  { id: 'token.squirrel', name: '松鼠', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 1, text: '', token: true },
  { id: 'token.void_worm', name: '虚空蠕虫', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 1, text: '', token: true },
  {
    id: 'token.mana_potion', name: '法力药水', type: 'spell', class: 'neutral', cost: 0, token: true,
    text: '本回合获得一个法力水晶',
    effects: [{ trigger: 'cast', actions: [{ kind: 'gain_mana', mode: 'temp', amount: 1 }] }],
  },
];
