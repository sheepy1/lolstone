// 卡面 SDF 字体子集要带的字：卡池里所有卡的名字和文本、职业名，加上数字和 ASCII。
// 子集文件旁边的 .chars.txt 记着实际带了哪些字，测试用它核对卡池没有用到子集外的字。
import { CARD_POOL, HERO_CLASSES } from '../cards';

export function cardFontChars(): string {
  const set = new Set<string>();
  const add = (s: string) => {
    for (const ch of s) set.add(ch);
  };
  for (const c of CARD_POOL) {
    add(c.name);
    add(c.text);
  }
  for (const h of HERO_CLASSES) add(h.name);
  for (let i = 32; i < 127; i++) add(String.fromCharCode(i));
  add('，。：；、！？（）「」…·—＋－');
  return [...set].sort().join('');
}
