// 动画调试台的法术和英雄技能场景（m4-storyboard E06、E09、E10、E23）。和战斗场景不同，这里的事件是真的引擎打出来的：
// 拿调试台的中盘局面，把要演示的法术塞进施法方手里（或者把英雄换成要演示的职业）、法力加满，再 applyAction，
// 所以事件的分组、目标、伤害数值、死亡和后续触发都和对局里一模一样。
// 引擎卡池里没有火焰和暗影的群体法术，调试台另外装两张测试牌（DEV_SPELL_CARDS），只给调试台用。
import { applyAction, listLegalActions, maskEvents, type Action, type CardDef, type GameState, type HeroClass, type Side } from '../engine';
import type { PresentationEvent } from '../presentation/events';
import { viewFromState, type ViewState } from '../presentation/viewState';

export const DEV_SPELL_CARDS: CardDef[] = [
  {
    id: 'dev.fire_group', name: '测试火焰群攻', type: 'spell', class: 'neutral', cost: 1, text: '对所有敌方随从造成2点伤害。',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 2, target: 'all_enemy_minions', fx: 'fire' }] }],
  },
  {
    id: 'dev.shadow_group', name: '测试暗影群攻', type: 'spell', class: 'neutral', cost: 1, text: '对所有敌方随从造成2点伤害。',
    effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 2, target: 'all_enemy_minions', fx: 'shadow' }] }],
  },
];

type Pick = 'enemy_minion' | 'enemy_hero' | 'friendly_minion' | null;
export type SpellCase = { card?: string; heroPower?: HeroClass; target: Pick };

export const SPELL_CASES = {
  '火 单体：诺克萨斯之力': { card: 'noxus.might_of_noxus', target: 'enemy_minion' },
  '火 单体打英雄：诺克萨斯之力': { card: 'noxus.might_of_noxus', target: 'enemy_hero' },
  '火 群体：测试火焰群攻': { card: 'dev.fire_group', target: null },
  '火 有益：血怒': { card: 'noxus.blood_rage', target: 'friendly_minion' },
  '冰 单体：魔法水晶箭': { card: 'freljord.crystal_arrow', target: 'enemy_minion' },
  '冰 群体：冰川裂隙': { card: 'freljord.glacial_fissure', target: null },
  '冰 群体：暴风雪（招牌兜底）': { card: 'freljord.blizzard', target: null },
  '光 单体：光盾': { card: 'demacia.light_shield', target: 'friendly_minion' },
  '光 单体：德玛西亚正义（招牌兜底）': { card: 'demacia.demacian_justice', target: 'enemy_minion' },
  '光 群体：集结': { card: 'demacia.rally', target: null },
  '光 回手：传送回城': { card: 'ionia.recall', target: 'friendly_minion' },
  '影 单体：灵魄突袭': { card: 'ionia.spirit_rush', target: 'enemy_minion' },
  '影 群体：测试暗影群攻': { card: 'dev.shadow_group', target: null },
  '影 有益：鬼切': { card: 'ionia.ghostblade', target: 'friendly_minion' },
  '物理 单体：飞斧': { card: 'noxus.flying_axe', target: 'enemy_minion' },
  '物理 消灭：处决': { card: 'noxus.execute', target: 'enemy_minion' },
  '物理 群体：大杀四方': { card: 'noxus.decimate', target: null },
  '物理 群体：审判（招牌兜底）': { card: 'demacia.judgment', target: null },
  '物理 群体：狂风绝息斩（招牌兜底）': { card: 'ionia.last_breath', target: null },
  '无目标：冥想（抽两张）': { card: 'ionia.meditate', target: null },
  '无目标：鹰击长空（抽一张）': { card: 'freljord.hawkshot', target: null },
  '无目标：凛冬将至（空水晶）': { card: 'freljord.winters_approach', target: null },
  '无目标：法力药水': { card: 'token.mana_potion', target: null },
  '英雄技能：德玛西亚召集': { heroPower: 'demacia', target: null },
  '英雄技能：诺克萨斯断头台': { heroPower: 'noxus', target: null },
  '英雄技能：艾欧尼亚灵魄（打随从）': { heroPower: 'ionia', target: 'enemy_minion' },
  '英雄技能：艾欧尼亚灵魄（打英雄）': { heroPower: 'ionia', target: 'enemy_hero' },
  '英雄技能：弗雷尔卓德寒冰箭': { heroPower: 'freljord', target: 'enemy_minion' },
} satisfies Record<string, SpellCase>;
export type SpellCaseName = keyof typeof SPELL_CASES;
export const SPELL_CASE_NAMES = Object.keys(SPELL_CASES) as SpellCaseName[];

// 施法方是 side（0 是我方、1 是对手），画面总是我方视角
export function prepareSpell(base: GameState, name: SpellCaseName, side: Side): { state: GameState; view: ViewState; action: Action } | null {
  const c: SpellCase = SPELL_CASES[name];
  const s: GameState = structuredClone(base);
  s.current = side;
  const p = s.players[side];
  p.mana = { max: 8, current: 8, temp: 0 };
  if (c.heroPower) {
    p.heroClass = c.heroPower;
    p.heroPowerUsed = false;
  }
  let handIndex = -1;
  if (c.card) {
    p.hand = [...p.hand.slice(0, 6), { instanceId: s.nextInstanceId++, cardId: c.card }];
    handIndex = p.hand.length - 1;
  }
  const enemy: Side = side === 0 ? 1 : 0;
  // 群体法术和召集：两边场上补到 5 个随从（复制已有的），看得出一道波；召集要给士兵留一个空位
  if (!c.target) {
    for (const s2 of [side, enemy]) {
      const b = s.players[s2].board;
      while (b.length > 0 && b.length < 5) b.push({ ...structuredClone(b[b.length % 2]), instanceId: s.nextInstanceId++, summonOrder: s.nextSummonOrder++ });
    }
  }
  const legal = listLegalActions(s, side).filter((a) => (c.heroPower ? a.kind === 'hero_power' : a.kind === 'play_card' && a.handIndex === handIndex));
  const want = (a: Action) => {
    const t = 'target' in a ? a.target : undefined;
    if (!c.target) return !t;
    if (!t) return false;
    if (c.target === 'enemy_hero') return t.kind === 'hero' && t.side === enemy;
    if (c.target === 'enemy_minion') return t.kind === 'minion' && t.side === enemy;
    return t.kind === 'minion' && t.side === side;
  };
  const options = legal.filter(want);
  // 目标取中间那个，飞弹斜着飞，看得出方向
  const action = options[Math.floor(options.length / 2)] ?? legal[0];
  if (!action) return null;
  return { state: s, view: viewFromState(s, 0), action };
}

export function spellEvents(state: GameState, action: Action): PresentationEvent[] | null {
  const r = applyAction(state, action);
  if (!r.ok) return null;
  return maskEvents(r.events, 0);
}
