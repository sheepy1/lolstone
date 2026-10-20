// 动作字段校验（docs/online.md 2.3 第三项、4.2 第 2 步、5.5 第 3 条）：checkAction 先查每个字段的类型和整数范围，
// 不对直接返回原因，局面不变。以前 handIndex 传字符串 "0" 能骗过 checkAction：法术生效了，牌还在手里。
import { describe, expect, it } from 'vitest';
import { applyAction, checkAction, checkActionShape } from '../src/engine';
import { scenario } from './helpers/scenario';

// 我方手里一张无目标法术（冥想：抽两张），法力够
function spellInHand() {
  return scenario().hand(0, ['冥想', '近战小兵']).deck(0, ['近战小兵', '近战小兵', '近战小兵']).board(1, ['近战小兵']).mana(0, 3).build();
}

describe('checkAction 的字段校验', () => {
  it('合法的动作照常通过', () => {
    const g = spellInHand();
    expect(checkAction(g.state, { kind: 'play_card', handIndex: 0 })).toBeNull();
    expect(checkAction(g.state, { kind: 'end_turn' })).toBeNull();
    // 可选字段写成 undefined 当作没给
    expect(checkAction(g.state, { kind: 'play_card', handIndex: 0, target: undefined })).toBeNull();
  });

  it('handIndex 是字符串 "0" 时直接拒绝，牌不会留在手里又生效', () => {
    const g = spellInHand();
    const before = structuredClone(g.state);
    const bad = { kind: 'play_card', handIndex: '0' };
    expect(checkAction(g.state, bad)).toMatch(/malformed action: bad handIndex/);
    const r = applyAction(g.state, bad as never);
    expect(r.ok).toBe(false);
    expect(g.state).toEqual(before);
  });

  const cases: [string, unknown][] = [
    ['handIndex 为负数', { kind: 'play_card', handIndex: -1 }],
    ['handIndex 为小数', { kind: 'play_card', handIndex: 0.5 }],
    ['handIndex 为 NaN', { kind: 'play_card', handIndex: NaN }],
    ['handIndex 为 Infinity', { kind: 'play_card', handIndex: Infinity }],
    ['缺 handIndex', { kind: 'play_card' }],
    ['position 为字符串', { kind: 'play_card', handIndex: 1, position: '0' }],
    ['多余字段', { kind: 'play_card', handIndex: 0, side: 1 }],
    ['end_turn 带多余字段', { kind: 'end_turn', player: 1 }],
    ['目标的 instanceId 为字符串', { kind: 'hero_power', target: { side: 1, kind: 'minion', instanceId: '5' } }],
    ['目标的 side 不是 0 或 1', { kind: 'hero_power', target: { side: 2, kind: 'hero' } }],
    ['目标带多余字段', { kind: 'attack', attacker: { side: 0, kind: 'hero', extra: 1 }, target: { side: 1, kind: 'hero' } }],
    ['目标的 kind 不认识', { kind: 'attack', attacker: { side: 0, kind: 'tower' }, target: { side: 1, kind: 'hero' } }],
    ['换牌的 replace 里混字符串', { kind: 'mulligan', player: 0, replace: [0, '1'] }],
    ['换牌的 replace 不是数组', { kind: 'mulligan', player: 0, replace: '0' }],
    ['换牌的 player 是字符串', { kind: 'mulligan', player: '0', replace: [] }],
    ['kind 不认识', { kind: 'cheat' }],
    ['kind 是原型上的名字', { kind: 'toString' }],
    ['不是对象', 'end_turn'],
    ['null', null],
    ['数组', [{ kind: 'end_turn' }]],
  ];

  for (const [name, action] of cases) {
    it(`${name}：拒绝，局面不变`, () => {
      const g = spellInHand();
      const before = structuredClone(g.state);
      expect(checkActionShape(action)).toMatch(/^malformed action/);
      expect(checkAction(g.state, action)).toMatch(/^malformed action/);
      expect(applyAction(g.state, action as never).ok).toBe(false);
      expect(g.state).toEqual(before);
    });
  }
});
