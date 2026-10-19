// L2 回合内搜索（spec 4.4）：斩杀、对方下回合威胁的估算、不偷看、按序列走和重新搜索、步数上限、对 L0 的胜率。
// L2 对 L1 的胜率矩阵用 pnpm arena --a l2 --b l1 跑（太慢，不放进单元测试），数据在 NOTES.md。
import { describe, expect, it } from 'vitest';
import { l0ChooseAction } from '../src/ai/l0';
import { createL2, heroPowerDamage, L2_DEFAULTS, nextTurnThreat, searchTurn } from '../src/ai/l2';
import { playGame } from '../src/ai/selfplay';
import type { ChooseAction } from '../src/ai/types';
import { PRESET_DECKS } from '../src/cards';
import { applyAction, maskHidden, seedRng, type Action, type GameState } from '../src/engine';
import { scenario } from './helpers/scenario';

// 让 AI 走完当前一方的回合
function playTurn(state: GameState, ai: ChooseAction): { actions: Action[]; state: GameState } {
  const side = state.current;
  const actions: Action[] = [];
  let rng = seedRng(7);
  for (let i = 0; i < 100; i++) {
    const choice = ai(state, side, rng);
    if (!choice) break;
    rng = choice.rng;
    actions.push(choice.action);
    const r = applyAction(state, choice.action);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
    if (choice.action.kind === 'end_turn' || state.phase === 'over') break;
  }
  return { actions, state };
}

describe('L2 斩杀', () => {
  it('能斩杀时这一回合就打死对方，不去换随从', () => {
    const g = scenario()
      .health(1, 5)
      .board(0, ['魔狼', '远程小兵'])
      .board(1, [{ card: '远古巨龙', attack: 8, health: 3, maxHealth: 8 }])
      .build();
    const { state } = playTurn(g.state, createL2());
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
  });

  it('关掉 L1 的斩杀判断，搜索本身也找得到斩杀序列（打死对方的分数最高）', () => {
    const g = scenario()
      .health(1, 5)
      .board(0, ['魔狼', '远程小兵'])
      .board(1, [{ card: '远古巨龙', attack: 8, health: 3, maxHealth: 8 }])
      .build();
    const { state } = playTurn(g.state, createL2({ lethalNodeLimit: 0 }));
    expect(state.winner).toBe(0);
  });
});

describe('对方下回合的威胁（spec 4.4）', () => {
  // 我方（0）结束回合之后的局面：轮到 1
  const afterEnd = (b: ReturnType<typeof scenario>) => {
    const g = b.build();
    const r = applyAction(g.state, { kind: 'end_turn' });
    if (!r.ok) throw new Error(r.error);
    return r.state;
  };

  it('对方能攻击的随从加英雄技能直伤', () => {
    const s = afterEnd(scenario().classes('demacia', 'noxus').board(1, ['魔狼', '远程小兵']));
    expect(heroPowerDamage('noxus')).toBeGreaterThan(0); // 诺克萨斯断头台打英雄
    expect(nextTurnThreat(s, 0)).toBe(3 + 2 + heroPowerDamage('noxus'));
  });

  it('被冻结的随从不算；我方嘲讽挡掉它的生命值那么多', () => {
    expect(heroPowerDamage('demacia')).toBe(0); // 德玛西亚的技能召唤士兵，不打脸
    const frozen = afterEnd(scenario().classes('demacia', 'demacia').board(1, ['魔狼', { card: '远程小兵', frozenAt: 1 }]));
    expect(nextTurnThreat(frozen, 0)).toBe(3);
    const taunt = afterEnd(scenario().classes('demacia', 'demacia').board(0, ['石甲虫']).board(1, ['魔狼', '远程小兵']));
    expect(nextTurnThreat(taunt, 0)).toBe(5 - 4);
  });
});

describe('L2 不偷看、结果确定', () => {
  const base = () =>
    scenario()
      .mana(0, 6)
      .board(0, ['魔狼', '石甲虫'])
      .board(1, ['远程小兵', '魔沼蛙'])
      .hand(0, ['拉克丝', '铁誓', '近战小兵']);

  it('对方手牌和牌库换成别的牌，L2 选的动作不变', () => {
    const a = base().hand(1, ['审判', '德玛西亚正义', '加里奥']).deck(1, ['纳什男爵', '远古巨龙']).build();
    const b = base().hand(1, ['近战小兵', '近战小兵', '近战小兵']).deck(1, ['近战小兵', '近战小兵']).build();
    const ta = playTurn(a.state, createL2());
    const tb = playTurn(b.state, createL2());
    expect(ta.actions.length).toBeGreaterThan(1);
    expect(ta.actions).toEqual(tb.actions);
  });

  it('我方牌库换成别的牌也不变（抽到什么在模拟里看不到）', () => {
    const a = base().deck(0, ['纳什男爵', '远古巨龙']).build();
    const b = base().deck(0, ['近战小兵', '近战小兵']).build();
    expect(playTurn(a.state, createL2()).actions).toEqual(playTurn(b.state, createL2()).actions);
  });

  it('不改传进来的局面；两个新实例对同一局面给出同一个序列', () => {
    const g = base().build();
    const before = structuredClone(g.state);
    const r1 = createL2()(g.state, 0, seedRng(1));
    expect(g.state).toEqual(before);
    expect(createL2()(g.state, 0, seedRng(2))!.action).toEqual(r1!.action);
  });
});

describe('L2 按序列走、对不上就重新搜', () => {
  it('真实局面和预期一致时直接给序列的下一步，不重新搜', () => {
    const g = scenario().mana(0, 6).board(0, ['魔狼', '石甲虫']).board(1, ['远程小兵', '魔沼蛙']).hand(0, ['铁誓', '近战小兵']).build();
    const ai = createL2();
    const first = ai(g.state, 0, seedRng(1))!;
    const search = ai.lastSearch()!;
    expect(search.plan[0]).toEqual(first.action);
    expect(search.plan[search.plan.length - 1]).toEqual({ kind: 'end_turn' });
    const r = applyAction(g.state, first.action);
    if (!r.ok) throw new Error(r.error);
    const second = ai(r.state, 0, first.rng)!;
    expect(ai.lastSearch()).toBe(search);
    expect(second.action).toEqual(search.plan[1]);
  });

  it('局面和预期不一致（比如对方的随从被换掉了）时重新搜', () => {
    const g = scenario().mana(0, 6).board(0, ['魔狼', '石甲虫']).board(1, ['远程小兵', '魔沼蛙']).hand(0, ['铁誓', '近战小兵']).build();
    const ai = createL2();
    const first = ai(g.state, 0, seedRng(1))!;
    const search = ai.lastSearch();
    const r = applyAction(g.state, first.action);
    if (!r.ok) throw new Error(r.error);
    const changed = structuredClone(r.state);
    changed.players[1].hero.health -= 1;
    ai(changed, 0, first.rng);
    expect(ai.lastSearch()).not.toBe(search);
  });
});

describe('L2 搜索的规模', () => {
  it('模拟步数不超过上限（每层最多多出一次结束回合的结算）', () => {
    const g = scenario()
      .mana(0, 10)
      .board(0, ['魔狼', '石甲虫', '远程小兵', '近战小兵'])
      .board(1, ['远程小兵', '魔沼蛙', '近战小兵'])
      .hand(0, ['拉克丝', '铁誓', '近战小兵', '远程小兵', '魔狼'])
      .build();
    for (const nodeLimit of [200, 1000]) {
      const r = searchTurn(maskHidden(g.state, 0), 0, { ...L2_DEFAULTS, nodeLimit });
      expect(r.nodes).toBeLessThanOrEqual(nodeLimit + 12);
      expect(r.plan.length).toBeGreaterThan(1);
    }
  });
});

describe('L2 对 L0', () => {
  it('几乎全胜', () => {
    let wins = 0;
    const games = 8;
    for (let g = 0; g < games; g++) {
      const l2Side = g % 2;
      const classes = (g % 4 < 2 ? ['demacia', 'noxus'] : ['freljord', 'ionia']) as ['demacia', 'noxus'];
      const r = playGame({
        seed: 300 + g,
        classes,
        decks: [[...PRESET_DECKS[classes[0]]!], [...PRESET_DECKS[classes[1]]!]],
        ais: l2Side === 0 ? [createL2(), l0ChooseAction] : [l0ChooseAction, createL2()],
      });
      if (r.winner === l2Side) wins += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(games - 1);
  });
});
