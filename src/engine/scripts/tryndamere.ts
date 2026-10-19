// 泰达米尔「无尽怒火」：第一次受到致命伤害时，生命值变为 1 而不是死亡。
// 只拦伤害导致的死亡（spec 2.6）：剧毒、消灭走 pendingDestroy，不经过这里，所以拦不住。
// 用过一次记在 usedOnce 里，沉默由调用方拦掉。
import type { ScriptHooks } from './index';

const KEY = 'tryndamere_undying';

export const tryndamereUndying: { name: string; hooks: ScriptHooks } = {
  name: KEY,
  hooks: {
    onLethalDamage: (self) => {
      if (self.usedOnce?.includes(KEY)) return false;
      self.usedOnce = [...(self.usedOnce ?? []), KEY];
      self.health = 1;
      return true;
    },
  },
};
