// 卡池加载时的校验（spec 3.5）。返回错误列表，空数组表示通过。
import { SCRIPTS } from '../engine/scripts';
import {
  ALL_KEYWORDS,
  type ActionTarget,
  type CardDef,
  type EffectAction,
  type HeroClassDef,
  type Keyword,
  type TargetPick,
} from '../engine/state';

const ACTION_KINDS = new Set<EffectAction['kind']>([
  'damage', 'heal', 'buff', 'summon', 'draw', 'freeze', 'silence', 'destroy', 'bounce', 'transform',
  'gain_mana', 'extra_attack', 'random_keyword',
]);
const ACTION_TARGETS = new Set<ActionTarget>([
  'chosen', 'self', 'friendly_hero', 'enemy_hero', 'all_enemy_minions', 'all_minions', 'other_friendly_minions',
  'random_enemy_minion', 'random_other_friendly_minion',
]);
const PICKS = new Set<TargetPick>(['any_character', 'any_minion', 'enemy_minion', 'friendly_minion', 'other_friendly_minion']);
const FX = new Set(['physical', 'fire', 'frost', 'holy', 'shadow']);
// fxId 命名（spec 3.4）：小写字母、数字、下划线，用一个点分成"英雄 key.招式"两段
const FX_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const TRIGGERS = new Set(['cast', 'battlecry', 'deathrattle', 'combo', 'turn_start', 'turn_end', 'on_kill', 'static']);
const TARGETABLE_TRIGGERS = new Set(['cast', 'battlecry', 'combo']);
const CLASSES = new Set(['neutral', 'demacia', 'noxus', 'ionia', 'freljord']);
// 需要 target 字段的动作
const TARGETED_ACTIONS = new Set(['damage', 'heal', 'buff', 'freeze', 'silence', 'destroy', 'bounce', 'transform', 'extra_attack', 'random_keyword']);

export function validateCardPool(cards: readonly CardDef[], classes: readonly HeroClassDef[]): string[] {
  const errors: string[] = [];
  const byId = new Map<string, CardDef>();
  const names = new Set<string>();
  for (const c of cards) {
    if (byId.has(c.id)) errors.push(`${c.id}: duplicate id`);
    byId.set(c.id, c);
    // 场景 DSL 按中文名找卡，所以名字也要唯一
    if (names.has(c.name)) errors.push(`${c.id}: duplicate name ${c.name}`);
    names.add(c.name);
  }

  for (const c of cards) {
    const err = (msg: string) => errors.push(`${c.id}: ${msg}`);
    if (!CLASSES.has(c.class)) err(`unknown class ${c.class}`);
    if (!Number.isInteger(c.cost) || c.cost < 0) err(`bad cost ${c.cost}`);
    const isMinion = c.type === 'minion';
    if (isMinion) {
      if (!Number.isInteger(c.attack) || c.attack! < 0) err('minion must have attack');
      if (!Number.isInteger(c.health) || c.health! < 1) err('minion must have health');
    } else {
      if (c.attack !== undefined || c.health !== undefined) err('spell and hero power must not have attack or health');
      if (c.keywords && c.keywords.length > 0) err('spell and hero power must not have keywords');
    }
    if (!['minion', 'spell', 'hero_power'].includes(c.type)) err(`unknown type ${c.type}`);
    for (const k of c.keywords ?? []) if (!ALL_KEYWORDS.includes(k)) err(`unknown keyword ${k}`);
    if (c.script !== undefined && !SCRIPTS[c.script]) err(`unknown script ${c.script}`);
    if (c.type === 'hero_power') {
      if (c.cost !== 2) err('hero power must cost 2');
      if (!c.token) err('hero power must be token');
    }

    let targeted = 0;
    for (const e of c.effects ?? []) {
      if (!TRIGGERS.has(e.trigger)) {
        err(`unknown trigger ${e.trigger}`);
        continue;
      }
      if (e.trigger === 'static') {
        if (!isMinion) err('static effect only allowed on minions');
        if (e.kind !== 'spell_damage' && e.kind !== 'enrage') err(`unknown static kind ${(e as { kind: string }).kind}`);
        if (e.kind === 'enrage') for (const k of e.keywords ?? []) if (!ALL_KEYWORDS.includes(k)) err(`unknown keyword ${k}`);
        continue;
      }
      if (isMinion && e.trigger === 'cast') err('minion cannot have cast effect');
      if (!isMinion && e.trigger !== 'cast') err(`${c.type} can only have cast effects`);
      if (e.target) {
        targeted += 1;
        if (!TARGETABLE_TRIGGERS.has(e.trigger)) err(`target only allowed on cast, battlecry, combo (got ${e.trigger})`);
        if (!PICKS.has(e.target.pick)) err(`unknown target pick ${e.target.pick}`);
      }
      if (!Array.isArray(e.actions) || e.actions.length === 0) err(`${e.trigger} effect has no actions`);
      for (const a of e.actions ?? []) {
        if (!ACTION_KINDS.has(a.kind)) {
          err(`unknown action ${a.kind}`);
          continue;
        }
        if ('target' in a || TARGETED_ACTIONS.has(a.kind)) {
          const t = (a as { target?: ActionTarget }).target;
          if (t === undefined || !ACTION_TARGETS.has(t)) err(`${a.kind}: unknown target ${t}`);
          if (t === 'chosen' && !e.target) err(`${a.kind}: uses chosen but effect declares no target`);
          if (t === 'self' && !isMinion) err(`${a.kind}: self target only allowed on minions`);
        }
        if ('fx' in a && !FX.has(a.fx)) err(`${a.kind}: unknown fx ${a.fx}`);
        if ('fxId' in a) {
          const fxId: unknown = a.fxId;
          const kind: string = a.kind;
          if (!('fx' in a)) err(`${kind}: fxId only allowed on actions with fx`);
          else if (typeof fxId !== 'string' || !FX_ID.test(fxId)) err(`${kind}: bad fxId ${String(fxId)}`);
        }
        if (a.kind === 'summon') {
          const token = byId.get(a.token);
          if (!token) err(`summon: unknown card ${a.token}`);
          else if (token.type !== 'minion') err(`summon: ${a.token} is not a minion`);
        }
        if (a.kind === 'transform') {
          const into = byId.get(a.into);
          if (!into) err(`transform: unknown card ${a.into}`);
          else if (into.type !== 'minion') err(`transform: ${a.into} is not a minion`);
        }
        if (a.kind === 'random_keyword') {
          if (a.from.length === 0) err('random_keyword: empty list');
          for (const k of a.from) if (!ALL_KEYWORDS.includes(k as Keyword)) err(`random_keyword: unknown keyword ${k}`);
        }
        if (a.kind === 'buff') for (const k of a.keywords ?? []) if (!ALL_KEYWORDS.includes(k)) err(`buff: unknown keyword ${k}`);
        if (a.kind === 'gain_mana' && a.mode !== 'empty' && a.mode !== 'temp') err(`gain_mana: unknown mode ${a.mode}`);
      }
    }
    // 动作里只有一个 target 字段，所以一张卡最多一个效果需要玩家选目标
    if (targeted > 1) err('at most one effect per card may declare a target');
  }

  // 英雄技能：每个职业恰好一个，职业定义引用的就是它
  for (const cls of classes) {
    const powers = cards.filter((c) => c.type === 'hero_power' && c.class === cls.id);
    if (powers.length !== 1) errors.push(`class ${cls.id}: must have exactly one hero power, found ${powers.length}`);
    const ref = byId.get(cls.heroPower);
    if (!ref || ref.type !== 'hero_power' || ref.class !== cls.id) {
      errors.push(`class ${cls.id}: heroPower ${cls.heroPower} is not its hero power card`);
    }
  }
  for (const c of cards) {
    if (c.type === 'hero_power' && !classes.some((cls) => cls.id === c.class)) {
      errors.push(`${c.id}: hero power of unknown class ${c.class}`);
    }
  }
  return errors;
}

// 组卡规则（spec 2.1）：30 张，同名最多 2 张，只能用本职业卡和中立卡，不能有衍生物和英雄技能。
export function validateDeck(cardIds: readonly string[], heroClass: string, cards: readonly CardDef[]): string[] {
  const errors: string[] = [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  if (cardIds.length !== 30) errors.push(`deck has ${cardIds.length} cards, expected 30`);
  const counts = new Map<string, number>();
  for (const id of cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    const c = byId.get(id);
    if (!c) {
      errors.push(`unknown card ${id}`);
      continue;
    }
    if (n > 2) errors.push(`${id}: ${n} copies, max 2`);
    if (c.token || c.type === 'hero_power') errors.push(`${id}: cannot be in a deck`);
    if (c.class !== 'neutral' && c.class !== heroClass) errors.push(`${id}: class ${c.class} not allowed in ${heroClass} deck`);
  }
  return errors;
}
