// 卡池加载时的校验（spec 3.5）和组卡规则（spec 2.1）。
import { describe, expect, it } from 'vitest';
import { CARD_POOL, HERO_CLASSES, PRESET_DECKS, validateCardPool, validateDeck } from '../src/cards';
import type { CardDef } from '../src/engine';

const base = (): CardDef[] => structuredClone([...CARD_POOL]);

function errorsWith(card: CardDef): string[] {
  return validateCardPool([...base(), card], HERO_CLASSES);
}

const minion = (over: Partial<CardDef>): CardDef => ({
  id: 'neutral.bad', name: '坏卡', type: 'minion', class: 'neutral', cost: 1, attack: 1, health: 1, text: '', ...over,
});
const spell = (over: Partial<CardDef>): CardDef => ({
  id: 'neutral.bad_spell', name: '坏法术', type: 'spell', class: 'neutral', cost: 1, text: '', ...over,
});

describe('卡池校验', () => {
  it('M1 卡池通过校验', () => {
    expect(validateCardPool(CARD_POOL, HERO_CLASSES)).toEqual([]);
  });

  it('引用的动作、目标、衍生物、脚本必须存在', () => {
    expect(errorsWith(spell({ effects: [{ trigger: 'cast', actions: [{ kind: 'explode' } as never] }] })).join()).toMatch(/unknown action/);
    expect(errorsWith(spell({ effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 1, target: 'everyone' as never, fx: 'fire' }] }] })).join()).toMatch(/unknown target/);
    expect(errorsWith(spell({ effects: [{ trigger: 'cast', target: { pick: 'nobody' as never }, actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'fire' }] }] })).join()).toMatch(/unknown target pick/);
    expect(errorsWith(spell({ effects: [{ trigger: 'cast', actions: [{ kind: 'summon', token: 'token.nope', count: 1, fx: 'holy' }] }] })).join()).toMatch(/summon: unknown card/);
    expect(errorsWith(minion({ effects: [{ trigger: 'battlecry', actions: [{ kind: 'transform', target: 'self', into: 'nope', fx: 'holy' }] }] })).join()).toMatch(/transform: unknown card/);
    expect(errorsWith(minion({ script: 'no_such_script' })).join()).toMatch(/unknown script/);
    expect(errorsWith(minion({ keywords: ['flying' as never] })).join()).toMatch(/unknown keyword/);
  });

  it('随从必有攻击和生命，法术和英雄技能没有', () => {
    expect(errorsWith(minion({ attack: undefined })).join()).toMatch(/must have attack/);
    expect(errorsWith(minion({ health: undefined })).join()).toMatch(/must have health/);
    expect(errorsWith(spell({ attack: 1, health: 1 })).join()).toMatch(/must not have attack/);
  });

  it('动作里用了 chosen 的效果必须声明 target', () => {
    const errors = errorsWith(spell({ effects: [{ trigger: 'cast', actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'fire' }] }] }));
    expect(errors.join()).toMatch(/uses chosen but effect declares no target/);
  });

  it('声明了 target 的效果时机只能是 cast、battlecry、combo', () => {
    const errors = errorsWith(minion({
      effects: [{ trigger: 'deathrattle', target: { pick: 'any_minion' }, actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'fire' }] }],
    }));
    expect(errors.join()).toMatch(/target only allowed/);
  });

  it('static 效果只能出现在随从上', () => {
    expect(errorsWith(spell({ effects: [{ trigger: 'static', kind: 'spell_damage', amount: 1 }] })).join()).toMatch(/static effect only allowed on minions/);
  });

  it('英雄技能费用为 2，每个职业恰好一个', () => {
    const cards = base();
    const hp = cards.find((c) => c.id === 'demacia.hero_power')!;
    hp.cost = 3;
    expect(validateCardPool(cards, HERO_CLASSES).join()).toMatch(/hero power must cost 2/);
    const dup = { ...structuredClone(hp), id: 'demacia.hero_power_2', name: '召集2', cost: 2 };
    expect(validateCardPool([...base(), dup], HERO_CLASSES).join()).toMatch(/exactly one hero power, found 2/);
    const none = base().filter((c) => c.id !== 'ionia.hero_power');
    expect(validateCardPool(none, HERO_CLASSES).join()).toMatch(/class ionia: must have exactly one hero power, found 0/);
  });

  it('实现约束：一张卡最多一个效果声明 target；id 和名字唯一', () => {
    const twoTargets = minion({
      effects: [
        { trigger: 'battlecry', target: { pick: 'any_minion' }, actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'fire' }] },
        { trigger: 'combo', target: { pick: 'any_minion' }, actions: [{ kind: 'damage', amount: 1, target: 'chosen', fx: 'fire' }] },
      ],
    });
    expect(errorsWith(twoTargets).join()).toMatch(/at most one effect/);
    expect(errorsWith(minion({ id: 'neutral.murk_wolf' })).join()).toMatch(/duplicate id/);
    expect(errorsWith(minion({ name: '魔狼' })).join()).toMatch(/duplicate name/);
  });
});

describe('组卡规则', () => {
  it('预组卡组合法', () => {
    expect(validateDeck(PRESET_DECKS.demacia!, 'demacia', CARD_POOL)).toEqual([]);
    expect(validateDeck(PRESET_DECKS.freljord!, 'freljord', CARD_POOL)).toEqual([]);
  });

  it('30 张、同名最多 2 张、只能用本职业和中立、不能有衍生物', () => {
    const deck = [...PRESET_DECKS.demacia!];
    expect(validateDeck(deck.slice(1), 'demacia', CARD_POOL).join()).toMatch(/expected 30/);
    expect(validateDeck([...deck.slice(1), deck[0]].map((_, i) => (i < 3 ? 'demacia.lux' : deck[i])), 'demacia', CARD_POOL).join()).toMatch(/max 2/);
    expect(validateDeck([...deck.slice(1), 'freljord.olaf'], 'demacia', CARD_POOL).join()).toMatch(/not allowed/);
    expect(validateDeck([...deck.slice(1), 'token.squirrel'], 'demacia', CARD_POOL).join()).toMatch(/cannot be in a deck/);
  });
});
