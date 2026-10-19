// 菲奥娜「决斗」：本随从攻击时不受反击伤害。
// 只管攻击方是菲奥娜的情况；她被攻击时照常受伤。
import type { ScriptHooks } from './index';

export const fioraDuel: { name: string; hooks: ScriptHooks } = {
  name: 'fiora_duel',
  hooks: {
    attackerCounterDamage: () => 0,
  },
};
