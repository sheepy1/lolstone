// 命令行对局。
//   pnpm play                         人（玩家0）对 AI（默认 L1），输入编号选择动作
//   pnpm play --auto --games 200      L0 对 L0 自动对局，冒烟用
// 选项：--seed N  --class <职业>  --ai-class <职业>  --ai l0|l1（人机对局的 AI，默认 l1）  --log（自动对局时打印事件）
// 职业：demacia、noxus、ionia、freljord。自动对局按 4×4 个先后手组合轮换。
import { createInterface } from 'node:readline';
import { l0ChooseAction } from '../ai/l0';
import { l1ChooseAction } from '../ai/l1';
import type { ChooseAction } from '../ai/types';
import { playL0Game } from '../ai/selfplay';
import { installDefaultPool, PRESET_DECKS } from '../cards';
import { listLegalActions } from '../engine/actions';
import { applyAction } from '../engine/game';
import type { GameEvent } from '../engine/events';
import { maskHidden } from '../engine/mask';
import { seedRng } from '../engine/rng';
import { createGame } from '../engine/setup';
import type { GameState, HeroClass, Side } from '../engine/state';
import { describeAction, describeEvent, formatState, NameBook } from './format';

const MAX_TURN = 120;
const CLASSES: HeroClass[] = ['demacia', 'noxus', 'ionia', 'freljord'];
const AIS: Record<string, ChooseAction> = { l0: l0ChooseAction, l1: l1ChooseAction };

type Args = {
  auto: boolean;
  games: number;
  seed: number;
  humanClass: HeroClass;
  aiClass: HeroClass;
  ai: string;
  log: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cls = (v: string | undefined, fallback: HeroClass): HeroClass => {
    if (v === undefined) return fallback;
    if (!PRESET_DECKS[v as HeroClass]) throw new Error(`没有 ${v} 的预组卡组，可选 ${CLASSES.join('、')}`);
    return v as HeroClass;
  };
  return {
    auto: argv.includes('--auto'),
    games: Number(get('--games') ?? 1),
    seed: get('--seed') !== undefined ? Number(get('--seed')) : Date.now() % 1_000_000,
    humanClass: cls(get('--class'), 'demacia'),
    aiClass: cls(get('--ai-class'), 'freljord'),
    ai: aiName(get('--ai')),
    log: argv.includes('--log'),
  };
}

function aiName(v: string | undefined): string {
  const name = v ?? 'l1';
  if (!AIS[name]) throw new Error(`没有叫 ${name} 的 AI，可选 ${Object.keys(AIS).join('、')}`);
  return name;
}

function deckOf(cls: HeroClass): string[] {
  return [...PRESET_DECKS[cls]!];
}

function runAuto(args: Args): void {
  const pairs = CLASSES.flatMap((a) => CLASSES.map((b): [HeroClass, HeroClass] => [a, b]));
  const wins = { 0: 0, 1: 0, draw: 0 } as Record<string, number>;
  const classWins: Record<string, number> = {};
  let maxTurn = 0;
  let totalTurns = 0;
  let failures = 0;
  for (let g = 0; g < args.games; g++) {
    const seed = args.seed + g;
    const pair = pairs[g % pairs.length];
    const book = new NameBook();
    try {
      const result = playL0Game({
        seed,
        classes: pair,
        decks: [deckOf(pair[0]), deckOf(pair[1])],
        onEvents: args.log
          ? (events, state) => {
              book.observe(state);
              book.observeEvents(events);
              for (const e of events) {
                const line = describeEvent(state, book, e);
                if (line) console.log(line);
              }
            }
          : undefined,
      });
      wins[String(result.winner)] += 1;
      if (result.winner !== 'draw') classWins[pair[result.winner]] = (classWins[pair[result.winner]] ?? 0) + 1;
      maxTurn = Math.max(maxTurn, result.turns);
      totalTurns += result.turns;
      if (result.turns > MAX_TURN) {
        failures += 1;
        console.error(`seed ${seed}: 打到第 ${result.turns} 回合，超过 ${MAX_TURN}`);
      }
      if (args.games <= 10) {
        console.log(`seed ${seed} ${pair.join(' vs ')}: 胜者 ${result.winner}，${result.turns} 回合，${result.actions} 步`);
      }
    } catch (e) {
      failures += 1;
      console.error(`seed ${seed}: ${(e as Error).stack ?? e}`);
    }
  }
  console.log(
    `L0 对 L0 共 ${args.games} 局（种子 ${args.seed}..${args.seed + args.games - 1}）：` +
      `玩家0 胜 ${wins['0']}，玩家1 胜 ${wins['1']}，平局 ${wins.draw}；` +
      `按职业 ${Object.entries(classWins).map(([k, v]) => `${k} ${v}`).join('，')}；` +
      `平均 ${(totalTurns / Math.max(1, args.games)).toFixed(1)} 回合，最长 ${maxTurn} 回合；失败 ${failures} 局`,
  );
  if (failures > 0) process.exitCode = 1;
}

// 逐行读标准输入。输入结束时返回 null。
function lineReader(): () => Promise<string | null> {
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  const waiters: ((line: string | null) => void)[] = [];
  let closed = false;
  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiters.splice(0)) w(null);
  });
  return () => {
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  };
}

async function runHuman(args: Args): Promise<void> {
  const HUMAN: Side = 0;
  const AI: Side = 1;
  const readLine = lineReader();
  const book = new NameBook();
  const print = (events: GameEvent[], state: GameState) => {
    book.observe(state);
    book.observeEvents(events);
    for (const e of events) {
      const line = describeEvent(state, book, e, HUMAN);
      if (line) console.log(line);
    }
  };
  console.log(`种子 ${args.seed}。你是${args.humanClass}，AI（${args.ai.toUpperCase()}）是${args.aiClass}。输入动作编号回车。`);
  const created = createGame({
    seed: args.seed,
    classes: [args.humanClass, args.aiClass],
    decks: [deckOf(args.humanClass), deckOf(args.aiClass)],
  });
  let state = created.state;
  print(created.events, state);
  let aiRng = seedRng(args.seed ^ 0x5eed);

  while (state.phase !== 'over') {
    const aiToAct = state.phase === 'mulligan' ? !state.players[AI].mulliganDone : state.current === AI;
    if (aiToAct) {
      // AI 只看自己能看到的信息来选动作；动作本身在真实局面上执行
      const choice = AIS[args.ai](maskHidden(state, AI), AI, aiRng);
      if (!choice) throw new Error('AI 没有合法动作');
      aiRng = choice.rng;
      const result = applyAction(state, choice.action);
      if (!result.ok) throw new Error(`AI 动作被拒绝：${result.error}`);
      state = result.state;
      print(result.events, state);
      continue;
    }
    const legal = listLegalActions(state, HUMAN);
    console.log('');
    console.log(formatState(state, HUMAN));
    console.log('可选动作：');
    legal.forEach((a, i) => console.log(`  ${i}. ${describeAction(state, book, a, HUMAN)}`));
    process.stdout.write('> ');
    const line = await readLine();
    if (line === null) {
      console.log('\n输入结束，退出。');
      return;
    }
    const n = Number(line.trim());
    if (!Number.isInteger(n) || n < 0 || n >= legal.length) {
      console.log(`请输入 0 到 ${legal.length - 1} 之间的编号`);
      continue;
    }
    const result = applyAction(state, legal[n]);
    if (!result.ok) {
      console.log(`动作非法：${result.error}`);
      continue;
    }
    state = result.state;
    print(result.events, state);
  }
  console.log(`对局结束，共 ${state.turn} 回合。`);
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
installDefaultPool();
if (args.auto) runAuto(args);
else await runHuman(args);
