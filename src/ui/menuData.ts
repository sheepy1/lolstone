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

export type Difficulty = 'l0' | 'l1';

export const DIFFICULTIES: { id: Difficulty; name: string; note: string }[] = [
  { id: 'l0', name: '新手', note: '对手随手出牌，适合熟悉规则' },
  { id: 'l1', name: '标准', note: '对手会算斩杀、会做交换' },
];

export function difficultyName(id: Difficulty): string {
  return DIFFICULTIES.find((d) => d.id === id)?.name ?? id;
}

// 加载页随机显示一条。都是第 2 节里新玩家第一局就会碰到的规则。
export const LOADING_TIPS: readonly string[] = [
  '先手起手 3 张牌；后手 4 张，外加一张「法力药水」。',
  '换牌时点选不想要的起手牌，换来的新牌不会是刚换掉的那张。',
  '「法力药水」是 0 费法术，用掉后本回合多一个法力水晶。',
  '法力水晶每回合加一个，最多 10 个，回合开始时全部回满。',
  '对方场上有嘲讽随从时，只能先攻击嘲讽随从。',
  '随从上场当回合不能攻击；冲锋例外，突袭当回合只能打随从。',
  '攻击时双方同时对对方造成伤害，出手前先算算会不会被反杀。',
  '圣盾会抵消第一次伤害，先用小随从把它戳掉。',
  '被冻结的随从不能攻击，到它主人的回合结束时才解冻。',
  '牌库抽空后每次抽牌都受疲劳伤害，第一次 1 点，之后逐次加 1。',
];

export function randomTip(): string {
  return LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]!;
}
