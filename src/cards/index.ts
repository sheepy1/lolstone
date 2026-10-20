// 卡池：中立卡、四个职业的职业卡和英雄技能、所有衍生物。
import { installCardPool } from '../engine/cardDb';
import type { CardDef } from '../engine/state';
import { HERO_CLASSES } from './classes';
import { DEMACIA_CARDS } from './demacia';
import { FRELJORD_CARDS } from './freljord';
import { IONIA_CARDS } from './ionia';
import { NEUTRAL_CARDS } from './neutral';
import { NOXUS_CARDS } from './noxus';
import { TOKEN_CARDS } from './tokens';
import { validateCardPool } from './validate';

export { HERO_CLASSES } from './classes';
export { PRESET_DECKS } from './decks';
export { poolHash } from './poolHash';
export { validateCardPool, validateDeck } from './validate';

export const CARD_POOL: readonly CardDef[] = [
  ...NEUTRAL_CARDS,
  ...DEMACIA_CARDS,
  ...FRELJORD_CARDS,
  ...NOXUS_CARDS,
  ...IONIA_CARDS,
  ...TOKEN_CARDS,
];

// 校验并装载卡池。extra 是额外的卡（测试专用卡）。校验不过时抛错。
export function installDefaultPool(extra: readonly CardDef[] = []): void {
  const cards = [...CARD_POOL, ...extra];
  const errors = validateCardPool(cards, HERO_CLASSES);
  if (errors.length > 0) throw new Error(`card pool invalid:\n${errors.join('\n')}`);
  installCardPool(cards, HERO_CLASSES);
}
