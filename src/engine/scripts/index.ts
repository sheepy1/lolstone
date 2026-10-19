// 走脚本的卡（spec 3.4 末尾）。卡牌数据里只写脚本名，这里注册对应的钩子。
// 被沉默的随从不再触发脚本，由调用方检查 silenced。
import type { MinionState } from '../state';
import { fioraDuel } from './fiora';
import { tryndamereUndying } from './tryndamere';

export type ScriptHooks = {
  // 本随从攻击时，调整它受到的反击伤害。返回调整后的数值。
  attackerCounterDamage?: (self: MinionState, amount: number) => number;
  // 本随从受到伤害后生命值小于等于 0 时调用。返回 true 表示拦下了这次死亡（钩子负责改生命值）。
  onLethalDamage?: (self: MinionState) => boolean;
};

export const SCRIPTS: Readonly<Record<string, ScriptHooks>> = {
  [fioraDuel.name]: fioraDuel.hooks,
  [tryndamereUndying.name]: tryndamereUndying.hooks,
};

export function getScript(name: string | undefined): ScriptHooks | undefined {
  return name === undefined ? undefined : SCRIPTS[name];
}
