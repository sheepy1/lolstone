// 菜单页面用的文字：四个职业的英雄名和一句话风格（spec 3.2）、AI 难度（spec 4.1）、加载页小提示（spec 第 2 节）。
import type { HeroClass } from '../engine';

export type ClassBlurb = {
  hero: string; // 职业英雄的中文名
  heroPower: string; // 英雄技能名
  pitch: string; // 一句话风格
  tags: [string, string]; // 两个风格关键词
};

export const CLASS_BLURBS: Record<HeroClass, ClassBlurb> = {
  demacia: { hero: '盖伦', heroPower: '召集', pitch: '铺开阵线，圣盾和嘲讽稳稳推进', tags: ['铺场', '圣盾'] },
  noxus: { hero: '德莱厄斯', heroPower: '诺克萨斯断头台', pitch: '抢先压血，每回合直斩敌方英雄', tags: ['快攻', '吸血'] },
  ionia: { hero: '阿狸', heroPower: '灵魄', pitch: '法术和潜行周旋，连击打出爆发', tags: ['法术', '潜行'] },
  freljord: { hero: '艾希', heroPower: '寒冰箭', pitch: '冻住对手的攻势，大块头接管后期', tags: ['冻结', '大体型'] },
};

export type Difficulty = 'l0' | 'l1' | 'l2';

export const DIFFICULTIES: { id: Difficulty; name: string; note: string }[] = [
  { id: 'l0', name: '新手', note: '对手随手出牌，适合熟悉规则' },
  { id: 'l1', name: '标准', note: '对手会算斩杀、会做交换' },
  { id: 'l2', name: '困难', note: '对手会规划整个回合，防着你下回合反扑' },
];

export function difficultyName(id: Difficulty): string {
  return DIFFICULTIES.find((d) => d.id === id)?.name ?? id;
}
