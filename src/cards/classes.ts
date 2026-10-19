// 四个职业（spec 3.2）。M2 才用到的诺克萨斯、艾欧尼亚也先把英雄技能写上。
import type { HeroClassDef } from '../engine/state';

export const HERO_CLASSES: HeroClassDef[] = [
  { id: 'demacia', name: '德玛西亚', champion: 'Garen', heroPower: 'demacia.hero_power' },
  { id: 'noxus', name: '诺克萨斯', champion: 'Darius', heroPower: 'noxus.hero_power' },
  { id: 'ionia', name: '艾欧尼亚', champion: 'Ahri', heroPower: 'ionia.hero_power' },
  { id: 'freljord', name: '弗雷尔卓德', champion: 'Ashe', heroPower: 'freljord.hero_power' },
];
