// 招牌卡专属特效（docs/m4-signature-fx.md）：fxId → 专属模块。导演钩子在 player.ts，查找规则在 registry.ts。
import type { Anim, AnimContext } from '../animations/types';
import type { PresentationEvent } from '../events';
import { warmSignatureFx } from './meshes';
import { signatureAnims as hook, type SignatureTable } from './registry';
import { glacialStorm } from './anivia';
import { handOfBaron } from './baron';
import { demacianJustice, judgment } from './garen';
import { deathLotus } from './katarina';
import { dragonsRage } from './leesin';
import { frozenTomb } from './lissandra';
import { highlander } from './masteryi';
import { undyingRage } from './tryndamere';
import { lastBreath } from './yasuo';
import { livingShadow } from './zed';

// 分镜清单里的 11 张。键是事件里的 fxId（泰达米尔、易由 registry.ts 的 TRIGGER_FX 按卡牌 id 加触发时机映射过来）
export const SIGNATURES: SignatureTable = {
  'yasuo.last_breath': lastBreath,
  'anivia.glacial_storm': glacialStorm,
  'lissandra.frozen_tomb': frozenTomb,
  'katarina.death_lotus': deathLotus,
  'garen.judgment': judgment,
  'garen.demacian_justice': demacianJustice,
  'tryndamere.undying_rage': undyingRage,
  'masteryi.highlander': highlander,
  'zed.living_shadow': livingShadow,
  'leesin.dragons_rage': dragonsRage,
  'baron.hand_of_baron': handOfBaron,
};

// 播放器每步调一次。第一次见到一个对局场景时顺手在后台预编译招牌特效的着色器
export function signatureAnims(
  events: readonly PresentationEvent[],
  ctxOf: (i: number) => AnimContext,
  byDefault: (e: PresentationEvent, i: number) => Anim,
  table: SignatureTable = SIGNATURES,
): Anim[] | null {
  if (events.length > 0) warmSignatureFx(ctxOf(0).scene);
  return hook(events, ctxOf, byDefault, table);
}

export { signatureIdOf, spellFxId, TRIGGER_FX, type SignatureCtx, type SignatureModule, type SignatureTable } from './registry';
