// AI 互打统计（spec 4.3 调权重、6.7 互打冒烟、M2 胜率区间）。
//   pnpm arena --a l1 --b l0 --games 100
//   pnpm arena --a l1 --b l1 --class-a demacia --class-b freljord,demacia --games 250 --seed 1
// 选项：
//   --a / --b              两边的 AI：l0 或 l1，默认 l1 对 l0
//   --class-a / --class-b  职业，逗号分隔，默认所有有预组的职业；每个组合（A 职业 × B 职业）各打 --games 局
//   --games N              每个职业组合的局数，默认 100
//   --seed N               起始种子，第 g 局用 seed + g，默认 1
//   --max-turn N           回合数超过它算失败，默认 120（spec 6.7）
// 同一组合里 A 和 B 轮流当先手（偶数局 A 先手），抵消先手优势。
import { l0ChooseAction } from '../ai/l0';
import { l1ChooseAction } from '../ai/l1';
import { playGame } from '../ai/selfplay';
import type { ChooseAction } from '../ai/types';
import { installDefaultPool, PRESET_DECKS } from '../cards';
import type { HeroClass, Side } from '../engine/state';

const AIS: Record<string, ChooseAction> = { l0: l0ChooseAction, l1: l1ChooseAction };

type Args = {
  a: string;
  b: string;
  classesA: HeroClass[];
  classesB: HeroClass[];
  games: number;
  seed: number;
  maxTurn: number;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ai = (v: string | undefined, fallback: string) => {
    const name = v ?? fallback;
    if (!AIS[name]) throw new Error(`没有叫 ${name} 的 AI，可选 ${Object.keys(AIS).join('、')}`);
    return name;
  };
  const available = Object.keys(PRESET_DECKS) as HeroClass[];
  const classes = (v: string | undefined): HeroClass[] => {
    if (v === undefined) return available;
    return v.split(',').map((c) => {
      if (!PRESET_DECKS[c as HeroClass]) throw new Error(`没有 ${c} 的预组卡组，可选 ${available.join('、')}`);
      return c as HeroClass;
    });
  };
  return {
    a: ai(get('--a'), 'l1'),
    b: ai(get('--b'), 'l0'),
    classesA: classes(get('--class-a')),
    classesB: classes(get('--class-b')),
    games: Number(get('--games') ?? 100),
    seed: Number(get('--seed') ?? 1),
    maxTurn: Number(get('--max-turn') ?? 120),
  };
}

// 每个 AI 的思考耗时：按"一方的一个回合"累计，回合结束（或对局结束）时记一笔。
class ThinkTimer {
  calls = 0;
  totalMs = 0;
  turns = 0;
  maxTurnMs = 0;
  maxCallMs = 0;
  private turnKey = '';
  private turnMs = 0;

  wrap(choose: ChooseAction): ChooseAction {
    return (state, side, rng) => {
      const key = `${state.turn}:${side}`;
      if (key !== this.turnKey) this.flush(key);
      const t0 = performance.now();
      const r = choose(state, side, rng);
      const ms = performance.now() - t0;
      this.calls += 1;
      this.totalMs += ms;
      this.turnMs += ms;
      this.maxCallMs = Math.max(this.maxCallMs, ms);
      return r;
    };
  }

  flush(nextKey = ''): void {
    if (this.turnKey) {
      this.turns += 1;
      this.maxTurnMs = Math.max(this.maxTurnMs, this.turnMs);
    }
    this.turnKey = nextKey;
    this.turnMs = 0;
  }
}

function pct(n: number, total: number): string {
  return `${((100 * n) / Math.max(1, total)).toFixed(1)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  installDefaultPool();
  const timers = { a: new ThinkTimer(), b: new ThinkTimer() };
  const aiA = timers.a.wrap(AIS[args.a]);
  const aiB = timers.b.wrap(AIS[args.b]);
  const label = (who: 'A' | 'B') => `${who}=${who === 'A' ? args.a : args.b}`;
  console.log(`${label('A')} 对 ${label('B')}，每个职业组合 ${args.games} 局，种子 ${args.seed} 起，回合上限 ${args.maxTurn}`);

  const total = { games: 0, winsA: 0, winsB: 0, draws: 0, failures: 0, ms: 0 };
  for (const classA of args.classesA) {
    for (const classB of args.classesB) {
      let winsA = 0;
      let winsB = 0;
      let draws = 0;
      let failures = 0;
      let turnSum = 0;
      let maxTurns = 0;
      let finished = 0;
      const t0 = performance.now();
      for (let g = 0; g < args.games; g++) {
        const seed = args.seed + g;
        const aSide: Side = g % 2 === 0 ? 0 : 1;
        const classes: [HeroClass, HeroClass] = aSide === 0 ? [classA, classB] : [classB, classA];
        try {
          const r = playGame({
            seed,
            classes,
            decks: [[...PRESET_DECKS[classes[0]]!], [...PRESET_DECKS[classes[1]]!]],
            ais: aSide === 0 ? [aiA, aiB] : [aiB, aiA],
          });
          finished += 1;
          turnSum += r.turns;
          maxTurns = Math.max(maxTurns, r.turns);
          if (r.winner === 'draw') draws += 1;
          else if (r.winner === aSide) winsA += 1;
          else winsB += 1;
          if (r.turns > args.maxTurn) {
            failures += 1;
            console.error(`seed ${seed} ${classes.join(' vs ')}：打到第 ${r.turns} 回合，超过 ${args.maxTurn}`);
          }
        } catch (e) {
          failures += 1;
          console.error(`seed ${seed} ${classes.join(' vs ')}：${(e as Error).stack ?? e}`);
        }
        timers.a.flush();
        timers.b.flush();
      }
      const ms = performance.now() - t0;
      console.log(
        `A ${classA} 对 B ${classB}：${args.games} 局，A 胜 ${winsA}（${pct(winsA, args.games)}），B 胜 ${winsB}，平局 ${draws}；` +
          `平均 ${(turnSum / Math.max(1, finished)).toFixed(1)} 回合，最长 ${maxTurns}；失败 ${failures}；` +
          `每局平均 ${(ms / Math.max(1, args.games)).toFixed(1)} ms`,
      );
      total.games += args.games;
      total.winsA += winsA;
      total.winsB += winsB;
      total.draws += draws;
      total.failures += failures;
      total.ms += ms;
    }
  }
  console.log(
    `合计 ${total.games} 局：A 胜 ${total.winsA}（${pct(total.winsA, total.games)}），B 胜 ${total.winsB}，平局 ${total.draws}；` +
      `失败 ${total.failures}；每局平均 ${(total.ms / Math.max(1, total.games)).toFixed(1)} ms`,
  );
  for (const [who, t] of [['A', timers.a], ['B', timers.b]] as const) {
    console.log(
      `${label(who)} 思考耗时：每次调用平均 ${(t.totalMs / Math.max(1, t.calls)).toFixed(2)} ms，` +
        `单次最长 ${t.maxCallMs.toFixed(1)} ms，每回合平均 ${(t.totalMs / Math.max(1, t.turns)).toFixed(2)} ms，` +
        `单回合最长 ${t.maxTurnMs.toFixed(1)} ms`,
    );
  }
  if (total.failures > 0) process.exitCode = 1;
}

main();
