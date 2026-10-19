import type { SourceRef } from '../events';
import type { MinionState, Side, TargetRef } from '../state';

// 执行一个效果时的环境。
export type EffectEnv = {
  source: SourceRef;
  side: Side; // 效果的拥有者
  selfId: number | null; // 发起效果的随从，法术和英雄技能为 null
  // 发起效果的随从已经离场时（亡语）留的快照，用来判断剧毒、吸血
  selfSnapshot: MinionState | null;
  chosen: TargetRef | null;
  isSpell: boolean; // 法术牌的效果才吃法术伤害
  // 召唤位置（spec 2.12）：right_of_self 战吼，at 亡语（死者原位置），rightmost 其余
  summon: { mode: 'right_of_self' } | { mode: 'at'; index: number } | { mode: 'rightmost' };
  summonVia: 'effect' | 'hero_power';
};
