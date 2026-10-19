// 要拉素材的英雄 key（Data Dragon 的 key，区分大小写）。
// 来源：docs/cards-v1.md 各表格的 key 列，加上四个职业的英雄。
// M1 合并后改成从 src/cards 读 champion 字段，这份列表就删掉。

// 中立
const NEUTRAL = ['Teemo', 'Lulu', 'Khazix', 'RekSai', 'Velkoz', 'Chogath'];

// 德玛西亚
const DEMACIA = [
  'Lucian', 'Vayne', 'Poppy', 'XinZhao', 'Quinn', 'Lux',
  'Fiora', 'Sona', 'JarvanIV', 'Galio', 'Kayle',
];

// 诺克萨斯
const NOXUS = [
  'Annie', 'Kled', 'Talon', 'Draven', 'Katarina',
  'Vladimir', 'Samira', 'Sion', 'Swain',
];

// 艾欧尼亚
const IONIA = [
  'Kennen', 'Akali', 'Karma', 'Zed', 'Yasuo', 'LeeSin',
  'Shen', 'Irelia', 'MasterYi', 'Yone', 'Syndra',
];

// 弗雷尔卓德
const FRELJORD = [
  'Olaf', 'Udyr', 'Braum', 'Sejuani', 'Anivia', 'Nunu',
  'Tryndamere', 'Trundle', 'Ornn', 'Lissandra', 'Volibear',
];

// 职业英雄：德玛西亚、诺克萨斯、艾欧尼亚、弗雷尔卓德
const CLASS_HEROES = ['Garen', 'Darius', 'Ahri', 'Ashe'];

export const CHAMPION_KEYS: readonly string[] = [
  ...new Set([...NEUTRAL, ...DEMACIA, ...NOXUS, ...IONIA, ...FRELJORD, ...CLASS_HEROES]),
];

/** 素材目录名：key 转小写，比如 JarvanIV → jarvaniv。 */
export function assetDir(key: string): string {
  return key.toLowerCase();
}
