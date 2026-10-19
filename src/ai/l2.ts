// L2 回合内搜索（spec 4.1、4.4）。
// 在 maskHidden(局面, 自己) 上对本回合的动作序列做深度优先搜索，每条序列以结束回合收尾，
// 分数 = 评估分 − 对方下回合能打到我方英雄的伤害 × threatWeight（spec 4.4：0.5），选分数最高的序列。
// - 先用 L1 的斩杀判断（findLethal），有斩杀直接执行。
// - 剪枝沿用 L1 的思路：随从只放最右边（candidateActions）；每个节点把子节点按"做完这一步的评估分"排序，
//   只往下搜前 branch[深度] 个；按局面去重（出牌顺序不同但结果一样的只搜一次）；总模拟步数不超过 nodeLimit。
// - 搜出来的序列记在闭包里，连同每一步之后预期的局面。下次调用时真实局面（遮过）对得上预期，就直接给序列的下一步；
//   对不上（抽到了牌、随机效果和模拟不一样）就从当前局面重新搜。
// - 不偷看：只在遮过的局面上算，对方手牌和双方牌库都是占位牌；随机数是 maskHidden 里 forkRng 派生的流。
// 接口和 L1 一样（ChooseAction），同步执行；浏览器里放进 Web Worker 跑（l2.worker.ts）。
import { listLegalActions, type Action } from '../engine/actions';
import { getCard, getHeroClass } from '../engine/cardDb';
import { applyAction } from '../engine/game';
import { hasKeyword, isFrozen, maxAttacks } from '../engine/keywords';
import { maskHidden } from '../engine/mask';
import { other, type GameState, type Side } from '../engine/state';
import { evaluate, EVAL_WEIGHTS, type EvalWeights } from './eval';
import { candidateActions, findLethal, mulliganChoice } from './l1';
import type { ChooseAction } from './types';

export type L2Options = {
  nodeLimit: number; // 一次搜索最多模拟多少步（applyAction 次数，含每个节点的结束回合）
  branch: number[]; // 第 d 层只往下搜评估分最高的前 branch[d] 个子节点（超出数组长度用最后一个）
  threatWeight: number; // 对方下回合威胁的权重（spec 4.4：0.5）
  dangerPenalty: number; // 威胁够打死我方英雄时再扣这么多分（spec 没写，调参用）
  stepPenalty: number; // 序列里每个动作（结束回合除外）扣的分，相当于 L1 的阈值：提升太小的动作不值得做
  evalBeforeEnd: boolean; // true：评估分取结束回合之前的局面（威胁仍按结束回合之后算）
  weights: EvalWeights;
  lethalNodeLimit: number; // L1 斩杀搜索的步数上限
};

export const L2_DEFAULTS: L2Options = {
  nodeLimit: 3000,
  branch: [64, 8, 5, 4, 3],
  threatWeight: 0.5,
  dangerPenalty: 0,
  stepPenalty: 0,
  evalBeforeEnd: false,
  weights: EVAL_WEIGHTS,
  lethalNodeLimit: 2000,
};

const END_TURN: Action = { kind: 'end_turn' };

// 局面的键：去重和核对"真实局面是否和预期一致"都用它。只看双方玩家（场面、手牌、牌库张数、法力、英雄……），
// 不看随机数流：模拟里的随机数是派生流，和真实对局本来就不同。
export function stateKey(s: GameState): string {
  return `${s.turn}|${s.current}|${s.phase}|${JSON.stringify(s.players)}`;
}

// 对方下回合能打到 side 英雄的伤害（spec 4.4）。只看场面：对方能攻击的随从（风怒算两次、冻结的不算）加英雄技能的直伤，
// 扣掉 side 的嘲讽挡住的部分（嘲讽的生命值，带圣盾再多挡一次对方最小的攻击）。对方手牌是未知的，不估。
// s 是 side 结束回合之后、对方回合开始时的局面。
export function nextTurnThreat(s: GameState, side: Side): number {
  const opp = other(side);
  const os = s.players[opp];
  let attack = 0;
  let minAttack = Infinity;
  for (const m of os.board) {
    // 对方回合开始时它的随从都已入场、攻击次数清零；被冻结的这一回合打不了
    if (m.attack <= 0 || isFrozen(m)) continue;
    attack += m.attack * maxAttacks(m);
    minAttack = Math.min(minAttack, m.attack);
  }
  let blocked = 0;
  for (const m of s.players[side].board) {
    if (!hasKeyword(m, 'taunt') || hasKeyword(m, 'stealth')) continue;
    blocked += m.health;
    if (hasKeyword(m, 'divine_shield') && Number.isFinite(minAttack)) blocked += minAttack;
  }
  return Math.max(0, attack - blocked) + heroPowerDamage(os.heroClass);
}

// 英雄技能能直接打到对方英雄的伤害
export function heroPowerDamage(cls: GameState['players'][number]['heroClass']): number {
  const def = getCard(getHeroClass(cls).heroPower);
  let dmg = 0;
  for (const e of def.effects ?? []) {
    if (e.trigger === 'static') continue;
    const anyTarget = e.target?.pick === 'any_character';
    for (const a of e.actions) {
      if (a.kind === 'damage' && (a.target === 'enemy_hero' || (a.target === 'chosen' && anyTarget))) dmg += a.amount;
    }
  }
  return dmg;
}

export type SearchResult = { plan: Action[]; keys: string[]; score: number; nodes: number };

// 从 view 出发搜本回合的动作序列。keys[0] 是 view 的键，keys[i + 1] 是做完 plan[i] 之后预期的局面的键。
export function searchTurn(view: GameState, side: Side, opts: L2Options = L2_DEFAULTS): SearchResult {
  let nodes = 0;
  const seen = new Set<string>();
  const rootKey = stateKey(view);
  let best: SearchResult = { plan: [END_TURN], keys: [rootKey], score: -Infinity, nodes: 0 };
  const path: Action[] = [];
  const keys: string[] = [rootKey];

  const consider = (score: number, plan: Action[], planKeys: string[]) => {
    if (score > best.score) best = { plan, keys: planKeys, score, nodes: 0 };
  };

  // 在 s 结束回合：结算回合结束和对方回合开始，打分
  const endHere = (s: GameState) => {
    nodes += 1;
    const r = applyAction(s, END_TURN);
    const after = r.ok ? r.state : s;
    let score = evaluate(opts.evalBeforeEnd ? s : after, side, opts.weights) - opts.stepPenalty * path.length;
    if (after.phase !== 'over') {
      const threat = nextTurnThreat(after, side);
      score -= opts.threatWeight * threat;
      if (threat >= after.players[side].hero.health) score -= opts.dangerPenalty;
    }
    consider(score, [...path, END_TURN], [...keys]);
  };

  const dfs = (s: GameState, depth: number) => {
    endHere(s);
    const kids: { action: Action; state: GameState; key: string; score: number }[] = [];
    for (const action of candidateActions(s, side)) {
      if (nodes >= opts.nodeLimit) break;
      nodes += 1;
      const r = applyAction(s, action);
      if (!r.ok) continue;
      if (r.state.phase === 'over') {
        // 打死对方（或者同归于尽）：序列到这里为止
        consider(evaluate(r.state, side, opts.weights), [...path, action], [...keys, stateKey(r.state)]);
        continue;
      }
      const key = stateKey(r.state);
      if (seen.has(key)) continue;
      kids.push({ action, state: r.state, key, score: evaluate(r.state, side, opts.weights) });
    }
    // 评估分高的先搜；分数相同时保持合法动作列表的顺序（出牌 → 英雄技能 → 攻击），结果是确定的
    kids.sort((a, b) => b.score - a.score);
    const width = opts.branch[Math.min(depth, opts.branch.length - 1)];
    for (const kid of kids.slice(0, width)) {
      if (nodes >= opts.nodeLimit) break;
      if (seen.has(kid.key)) continue;
      seen.add(kid.key);
      path.push(kid.action);
      keys.push(kid.key);
      dfs(kid.state, depth + 1);
      path.pop();
      keys.pop();
    }
  };

  seen.add(rootKey);
  dfs(view, 0);
  return { ...best, nodes };
}

// 带状态的 L2：记住上一次搜出的序列。每个 createL2() 的实例各记各的（arena 里两边是两个实例）。
export function createL2(options: Partial<L2Options> = {}): ChooseAction & { lastSearch: () => SearchResult | null } {
  const opts: L2Options = { ...L2_DEFAULTS, ...options };
  let plan: { side: Side; plan: Action[]; keys: string[] } | null = null;
  let last: SearchResult | null = null;
  const choose: ChooseAction = (state, side, rng) => {
    if (listLegalActions(state, side).length === 0) return null;
    if (state.phase === 'mulligan') {
      plan = null;
      return { action: mulliganChoice(state, side), rng };
    }
    const view = maskHidden(state, side);
    const key = stateKey(view);
    // 真实局面对得上预期：接着走序列的下一步
    if (plan && plan.side === side) {
      const i = plan.keys.lastIndexOf(key);
      if (i >= 0 && i < plan.plan.length) return { action: plan.plan[i], rng };
    }
    const lethal = findLethal(view, side, opts.lethalNodeLimit);
    if (lethal) {
      plan = null;
      return { action: lethal, rng };
    }
    last = searchTurn(view, side, opts);
    plan = { side, plan: last.plan, keys: last.keys };
    return { action: last.plan[0], rng };
  };
  return Object.assign(choose, { lastSearch: () => last });
}

// 默认参数的 L2。注意它带状态（记着搜出的序列），同一个实例不要同时给两方用；arena 和对局各自 createL2()。
export const l2ChooseAction = createL2();
