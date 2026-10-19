// 卡池注册表。卡牌数据在 src/cards 里定义、校验，再装进这里；引擎只通过这里查卡。
// 卡池是静态数据，不进局面，所以局面保持纯 JSON。
import { HIDDEN_CARD_ID, type CardDef, type HeroClass, type HeroClassDef } from './state';

// maskHidden 用的占位牌：不能打出，只占位置。
const HIDDEN_CARD: CardDef = {
  id: HIDDEN_CARD_ID,
  name: '未知卡牌',
  type: 'spell',
  class: 'neutral',
  cost: 0,
  text: '',
  token: true,
};

let cards = new Map<string, CardDef>();
let classes = new Map<HeroClass, HeroClassDef>();

export function installCardPool(defs: readonly CardDef[], classDefs: readonly HeroClassDef[]): void {
  cards = new Map(defs.map((d) => [d.id, d]));
  classes = new Map(classDefs.map((c) => [c.id, c]));
}

export function findCard(id: string): CardDef | undefined {
  if (id === HIDDEN_CARD_ID) return HIDDEN_CARD;
  return cards.get(id);
}

export function getCard(id: string): CardDef {
  const def = findCard(id);
  if (!def) throw new Error(`unknown card id: ${id}`);
  return def;
}

export function getHeroClass(id: HeroClass): HeroClassDef {
  const def = classes.get(id);
  if (!def) throw new Error(`unknown hero class: ${id}`);
  return def;
}

export function allCards(): CardDef[] {
  return [...cards.values()];
}

export function allHeroClasses(): HeroClassDef[] {
  return [...classes.values()];
}
