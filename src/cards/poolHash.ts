// 卡池哈希（docs/online.md 4.1、5.1）：页面和逻辑模块各自对装好的卡池算一次，建局时客户端把自己的交给逻辑模块，
// setup 发现两边不一致就拒绝开局（version_mismatch），避免缓存了旧页面的客户端用另一套卡牌数据打。
// 只用 ES 内置对象，逻辑模块的隔离环境里也能算。
import { allCards, allHeroClasses } from '../engine/cardDb';

// 当前装好的卡池（卡牌和职业）的哈希，8 位十六进制。按 id 排序后序列化，装卡的先后顺序不影响结果
export function poolHash(): string {
  const cards = allCards().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const classes = allHeroClasses().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return fnv1a(JSON.stringify([cards, classes]));
}

// FNV-1a 32 位。只用来发现两边数据不同，不防伪造：客户端想骗只能骗自己，卡组照样由 validateDeck 按模块里的卡池查
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
