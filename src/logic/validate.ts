// 逻辑模块收到的外来数据的形状校验（docs/online.md 4.1、4.2 第 2 步、5.5 第 3 条）：座位 config 和动作。
// 平台只保证它们是 JSON、不超过 4 KiB，其余都在这里查；引擎的 Action 由 checkActionShape 查，这里只多一个认输。
import { PRESET_DECKS } from '../cards/decks';
import { allHeroClasses } from '../engine/cardDb';
import { checkActionShape } from '../engine/actions';
import type { HeroClass } from '../engine';
import type { BotLevel, ConcedeAction } from './state';

// 一个座位开局要用的东西：职业、卡组，人类座位还有客户端的卡池哈希，bot 座位还有等级
export type SeatSetup =
  | { kind: 'human'; heroClass: HeroClass; deck: string[]; poolHash: string }
  | { kind: 'bot'; heroClass: HeroClass; deck: string[]; level: BotLevel };

const BOT_LEVELS: readonly unknown[] = ['L0', 'L1'];

// setup 的 seats：正好两个座位。人类座位的 config 是 { heroClass, deck, poolHash }；bot 座位是 { level, heroClass }，
// 可以带 deck，不带就用这个职业的预组。多余字段、类型不对都算 malformed，返回原因
export function parseSeats(seats: unknown): { ok: true; seats: [SeatSetup, SeatSetup] } | { ok: false; reason: string } {
  if (!Array.isArray(seats) || seats.length !== 2) return { ok: false, reason: 'malformed seats: expected 2 seats' };
  const out: SeatSetup[] = [];
  for (let i = 0; i < 2; i++) {
    const r = parseSeat(seats[i]);
    if (typeof r === 'string') return { ok: false, reason: `malformed seat ${i}: ${r}` };
    out.push(r);
  }
  return { ok: true, seats: out as [SeatSetup, SeatSetup] };
}

function parseSeat(spec: unknown): SeatSetup | string {
  if (!isRecord(spec) || (spec.kind !== 'human' && spec.kind !== 'bot')) return 'bad kind';
  const c = spec.config;
  if (!isRecord(c)) return 'config is not an object';
  if (spec.kind === 'human') {
    const extra = extraField(c, ['heroClass', 'deck', 'poolHash']);
    if (extra) return `unexpected field ${extra}`;
    if (!isHeroClass(c.heroClass)) return 'bad heroClass';
    if (!isDeck(c.deck)) return 'bad deck';
    if (typeof c.poolHash !== 'string') return 'bad poolHash';
    return { kind: 'human', heroClass: c.heroClass, deck: [...c.deck], poolHash: c.poolHash };
  }
  const extra = extraField(c, ['level', 'heroClass', 'deck']);
  if (extra) return `unexpected field ${extra}`;
  if (!BOT_LEVELS.includes(c.level)) return 'bad level';
  if (!isHeroClass(c.heroClass)) return 'bad heroClass';
  if (c.deck !== undefined && !isDeck(c.deck)) return 'bad deck';
  const deck = c.deck === undefined ? PRESET_DECKS[c.heroClass] : c.deck;
  return { kind: 'bot', heroClass: c.heroClass, deck: [...deck], level: c.level as BotLevel };
}

// 动作的形状（4.2 第 2 步）：认输或者引擎的六种动作之一，字段类型和多余字段都查。通过返回 null
export function checkMatchActionShape(action: unknown): string | null {
  return isConcede(action) ? null : checkActionShape(action);
}

export function isConcede(action: unknown): action is ConcedeAction {
  if (!isRecord(action)) return false;
  const keys = Object.keys(action);
  return keys.length === 1 && keys[0] === 'kind' && action.kind === 'concede';
}

export function isSeat(seat: unknown): seat is 0 | 1 {
  return seat === 0 || seat === 1;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extraField(o: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(o).find((k) => !allowed.includes(k)) ?? null;
}

function isHeroClass(v: unknown): v is HeroClass {
  return typeof v === 'string' && allHeroClasses().some((c) => c.id === v);
}

// 卡组的形状：字符串数组，张数不超过 60（validateDeck 再查正好 30 张、卡牌存在、职业和张数限制）
function isDeck(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 60 && v.every((x) => typeof x === 'string');
}
