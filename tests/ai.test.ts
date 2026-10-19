// L1 贪心 AI（spec 4.2、4.3）和 AI 互打。
import { describe, expect, it } from 'vitest';
import { evaluate, minionValue } from '../src/ai/eval';
import { l0ChooseAction } from '../src/ai/l0';
import { createL1, findLethal, l1ChooseAction, mulliganChoice } from '../src/ai/l1';
import { playGame } from '../src/ai/selfplay';
import type { ChooseAction } from '../src/ai/types';
import { PRESET_DECKS } from '../src/cards';
import {
  applyAction,
  maskHidden,
  seedRng,
  type Action,
  type GameState,
  type HeroClass,
  type Side,
} from '../src/engine';
import { scenario, type Game } from './helpers/scenario';

// 让 AI 走完当前一方的回合：反复调用直到它结束回合或对局结束。返回它选的动作和最后的局面。
function playTurn(state: GameState, ai: ChooseAction = l1ChooseAction): { actions: Action[]; state: GameState } {
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

function firstAction(g: Game): Action {
  return l1ChooseAction(g.state, g.state.current, seedRng(1))!.action;
}

describe('评估函数', () => {
  it('随从价值按 spec 4.3 算，冻结的随从攻击按 0 算', () => {
    const g = scenario()
      .board(0, ['魔狼', { card: '魔狼', frozenAt: 4 }, '波比', '提莫'])
      .build();
    const [wolf, frozenWolf, poppy, teemo] = g.p(0).board;
    expect(minionValue(wolf)).toBeCloseTo(3 + 2 * 0.8 + 0.5);
    expect(minionValue(frozenWolf)).toBeCloseTo(0 + 2 * 0.8 + 0.5);
    // 波比 1/4 嘲讽圣盾
    expect(minionValue(poppy)).toBeCloseTo(1 + 4 * 0.8 + 0.5 + 1 + 1 * 0.5);
    // 提莫 1/1 潜行剧毒
    expect(minionValue(teemo)).toBeCloseTo(1 + 0.8 + 0.5 + 0.5 + 2);
  });

  it('生命差按职业加权，手牌差 0.7，胜负 ±1000', () => {
    const g = scenario().classes('freljord', 'demacia').health(0, 20).health(1, 10).hand(0, ['魔狼']).build();
    expect(evaluate(g.state, 0)).toBeCloseTo(0.6 * 10 + 0.7);
    expect(evaluate(g.state, 1)).toBeCloseTo(1.0 * -10 - 0.7);
    const dead = scenario().health(1, 0).build();
    expect(evaluate(dead.state, 0)).toBeCloseTo(1000 + 30);
  });

  it('法力上限差每个水晶 2 分，上限按 10 封顶', () => {
    const g = scenario().mana(0, 3, 5).mana(1, 4, 7).build();
    expect(evaluate(g.state, 0)).toBeCloseTo(2 * (5 - 7));
    const full = scenario().mana(0, 10, 10).mana(1, 4, 7).build();
    expect(evaluate(full.state, 0)).toBeCloseTo(2 * (10 - 7));
  });
});

describe('L1 换牌', () => {
  it('先手换掉所有费用大于等于 4 的牌', () => {
    const g = scenario().hand(0, ['远程小兵', '拉克丝', '加里奥', '卡兹克']).build();
    expect(mulliganChoice(g.state, 0)).toEqual({ kind: 'mulligan', player: 0, replace: [1, 2, 3] });
  });

  it('后手（有法力药水）保留一张 4 费，5 费以上照换', () => {
    const g = scenario().hand(1, ['远程小兵', '拉克丝', '加里奥', '卡兹克', '法力药水']).build();
    expect(mulliganChoice(g.state, 1)).toEqual({ kind: 'mulligan', player: 1, replace: [2, 3] });
  });

  it('在换牌阶段返回合法的换牌动作', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = playGame({
        seed,
        classes: ['demacia', 'freljord'],
        decks: [[...PRESET_DECKS.demacia!], [...PRESET_DECKS.freljord!]],
        ais: [l1ChooseAction, l1ChooseAction],
        maxActions: 3000,
      });
      expect(r.state.phase).toBe('over');
    }
  });
});

describe('L1 斩杀', () => {
  // 敌方 5 血，场上有一条攻击 8、只剩 3 血的远古巨龙。单看一步，用魔狼换掉巨龙（+5.8）比打脸（+3）分高，
  // 但魔狼 3 + 远程小兵 2 正好打死对方英雄。
  const tempting = () =>
    scenario()
      .health(1, 5)
      .board(0, ['魔狼', '远程小兵'])
      .board(1, [{ card: '远古巨龙', attack: 8, health: 3, maxHealth: 8 }])
      .build();

  it('能斩杀时打脸，不去换随从', () => {
    const g = tempting();
    const { state } = playTurn(g.state);
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
  });

  it('关掉斩杀判断的贪心这回合打不死（说明是斩杀判断起了作用）', () => {
    const g = tempting();
    const { state } = playTurn(g.state, createL1({ lethalNodeLimit: 0 }));
    expect(state.phase).toBe('playing');
  });

  it('嘲讽挡路时先解掉嘲讽再打脸', () => {
    const g = scenario()
      .health(1, 5)
      .mana(0, 5)
      .board(0, ['魔狼', '远程小兵'])
      .board(1, ['石甲虫'])
      .hand(0, ['德玛西亚正义'])
      .build();
    const { actions, state } = playTurn(g.state);
    expect(state.winner).toBe(0);
    expect(actions[0]).toMatchObject({ kind: 'play_card', target: { side: 1, kind: 'minion' } });
  });

  it('伤害不够时不报斩杀', () => {
    const g = scenario().health(1, 6).board(0, ['魔狼', '远程小兵']).build();
    expect(findLethal(maskHidden(g.state, 0), 0, 2000)).toBeNull();
  });

  it('直伤法术和英雄技能算进斩杀', () => {
    // 诺克萨斯英雄技能 2 点打脸 + 魔法水晶箭 3 点
    const g = scenario().classes('noxus', 'demacia').health(1, 5).mana(0, 6).hand(0, ['魔法水晶箭']).build();
    const { state } = playTurn(g.state);
    expect(state.winner).toBe(0);
  });
});

describe('L1 交换', () => {
  it('用小随从换掉对方高价值随从', () => {
    // 远程小兵 2/1 撞死 8/2 的远古巨龙：对方少 10.1 分，我方少 3.3 分，比打脸 2 点划算
    const g = scenario()
      .board(0, ['远程小兵'])
      .board(1, [{ card: '远古巨龙', attack: 8, health: 2, maxHealth: 8 }])
      .build();
    expect(firstAction(g)).toEqual({ kind: 'attack', attacker: g.m(0, '远程小兵'), target: g.m(1, '远古巨龙') });
  });

  it('不用随从去撞打不过又换不掉的嘲讽', () => {
    const g = scenario().board(0, ['远程小兵', '魔狼']).board(1, ['奥恩']).build();
    const { actions } = playTurn(g.state);
    expect(actions.filter((a) => a.kind === 'attack')).toEqual([]);
    expect(actions.at(-1)).toEqual({ kind: 'end_turn' });
  });

  it('手里的法力药水能让它多出一张牌时会用', () => {
    const g = scenario().mana(0, 2).hand(0, ['法力药水', '奎因']).build();
    const { actions } = playTurn(g.state);
    expect(actions[0]).toEqual({ kind: 'play_card', handIndex: 0 });
    expect(actions[1]).toMatchObject({ kind: 'play_card', handIndex: 0 });
  });
});

describe('L1 往后多看一步的动作', () => {
  it('2 费没有更好的用法时打凛冬将至', () => {
    const g = scenario().classes('freljord', 'demacia').mana(0, 2).hand(0, ['凛冬将至']).build();
    const { actions, state } = playTurn(g.state);
    expect(actions[0]).toEqual({ kind: 'play_card', handIndex: 0 });
    expect(state.players[0].mana.max).toBe(3);
  });

  it('有 2 费随从时先出随从，不打凛冬将至', () => {
    const g = scenario().classes('freljord', 'demacia').mana(0, 2).hand(0, ['凛冬将至', '奥拉夫']).build();
    expect(firstAction(g)).toMatchObject({ kind: 'play_card', handIndex: 1 });
  });

  it('手里有连击牌时先出别的牌，让连击生效', () => {
    // 单看一步阿卡丽（+4.9）比近战小兵（+2.4）高；先出小兵再出阿卡丽，阿卡丽是 5/2
    const g = scenario().classes('ionia', 'demacia').mana(0, 4).hand(0, ['阿卡丽', '近战小兵']).build();
    const { actions, state } = playTurn(g.state);
    expect(actions[0]).toMatchObject({ kind: 'play_card', handIndex: 1 });
    const akali = state.players[0].board.find((m) => m.cardId === 'ionia.akali');
    expect(akali?.attack).toBe(5);
  });

  it('用传送回城收回受伤的永恩，重新打出再触发战吼', () => {
    const g = scenario()
      .classes('ionia', 'demacia')
      .mana(0, 6)
      .board(0, [{ card: '永恩', health: 1 }])
      .board(1, ['魔狼'])
      .hand(0, ['传送回城'])
      .build();
    const { actions, state } = playTurn(g.state);
    expect(actions[0]).toEqual({ kind: 'play_card', handIndex: 0, target: g.m(0, '永恩') });
    expect(state.players[1].board).toHaveLength(0);
    expect(state.players[0].board.map((m) => [m.cardId, m.health])).toEqual([['ionia.yone', 4]]);
  });

  it('易先消灭随从再用多出来的攻击打脸', () => {
    // 只看一步打脸 4 分比消灭远程小兵（+1.7）高；算上消灭后的第二次攻击，先打随从更好
    const g = scenario().classes('ionia', 'demacia').board(0, ['易']).board(1, ['远程小兵']).build();
    const { actions } = playTurn(g.state);
    expect(actions.slice(0, 2)).toEqual([
      { kind: 'attack', attacker: g.m(0, '易'), target: g.m(1, '远程小兵') },
      { kind: 'attack', attacker: g.m(0, '易'), target: g.hero(1) },
    ]);
  });

  it('斩杀估算算上易打死嘲讽后的再次攻击', () => {
    const g = scenario().classes('ionia', 'demacia').health(1, 4).mana(0, 0).board(0, ['易']).board(1, ['石甲虫']).build();
    expect(findLethal(maskHidden(g.state, 0), 0, 2000)).toEqual({
      kind: 'attack',
      attacker: g.m(0, '易'),
      target: g.m(1, '石甲虫'),
    });
  });
});

describe('L1 不偷看、结果确定', () => {
  it('对方手牌和牌库换成别的牌，L1 选的动作不变', () => {
    const base = () =>
      scenario()
        .mana(0, 6)
        .board(0, ['魔狼', '石甲虫'])
        .board(1, ['远程小兵', '魔沼蛙'])
        .hand(0, ['拉克丝', '铁誓', '近战小兵']);
    const a = base().hand(1, ['审判', '德玛西亚正义', '加里奥']).deck(1, ['纳什男爵', '远古巨龙']).build();
    const b = base().hand(1, ['近战小兵', '近战小兵', '近战小兵']).deck(1, ['近战小兵', '近战小兵']).build();
    const ta = playTurn(a.state);
    const tb = playTurn(b.state);
    expect(ta.actions.length).toBeGreaterThan(1);
    expect(ta.actions).toEqual(tb.actions);
  });

  it('不消耗真实对局的随机数', () => {
    const g = scenario().mana(0, 6).board(0, ['魔狼']).board(1, ['远程小兵']).hand(0, ['拉克丝']).build();
    const before = structuredClone(g.state);
    l1ChooseAction(g.state, 0, seedRng(1));
    expect(g.state).toEqual(before);
  });

  it('同一局面、同一种子，结果相同', () => {
    const run = () =>
      playGame({
        seed: 42,
        classes: ['freljord', 'demacia'],
        decks: [[...PRESET_DECKS.freljord!], [...PRESET_DECKS.demacia!]],
        ais: [l1ChooseAction, l1ChooseAction],
      });
    const r1 = run();
    const r2 = run();
    expect(r2.winner).toBe(r1.winner);
    expect(r2.actions).toBe(r1.actions);
    expect(r2.state).toEqual(r1.state);
  });
});

describe('AI 互打', () => {
  const classes: HeroClass[] = ['demacia', 'freljord'];
  const decks = (pair: [HeroClass, HeroClass]): [string[], string[]] => [
    [...PRESET_DECKS[pair[0]]!],
    [...PRESET_DECKS[pair[1]]!],
  ];

  it('L1 对 L1 200 局不报错、不卡死，turn 不超过 120', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const pair: [HeroClass, HeroClass] = [classes[seed % 2], classes[(seed >> 1) % 2]];
      const r = playGame({ seed, classes: pair, decks: decks(pair), ais: [l1ChooseAction, l1ChooseAction], maxActions: 5000 });
      expect(r.state.phase).toBe('over');
      expect(r.turns, `seed ${seed}`).toBeLessThanOrEqual(120);
    }
  });

  it('L1 对 L0 胜率明显高于 50%', () => {
    let wins = 0;
    const games = 80;
    for (let g = 0; g < games; g++) {
      const l1Side: Side = g % 2 === 0 ? 0 : 1;
      const pair: [HeroClass, HeroClass] = [classes[g % 2], classes[(g >> 1) % 2]];
      const r = playGame({
        seed: 1000 + g,
        classes: pair,
        decks: decks(pair),
        ais: l1Side === 0 ? [l1ChooseAction, l0ChooseAction] : [l0ChooseAction, l1ChooseAction],
      });
      if (r.winner === l1Side) wins += 1;
    }
    expect(wins / games).toBeGreaterThan(0.85);
  });
});
