// 进程内的假平台（docs/online.md 3.3、4.3、4.4、5.3）：只给测试和开发用，生产构建里按需加载，不进首包。
// 后面接一个权威对局 Table，按协议模拟平台做的事：
// - 房间和邀请码：建房的人是 0 号位，人类座位按进局先后排，bot 座位排在最后；座位到齐、人类都在线时开局。
// - 开局先用逻辑模块的 setup 查座位 config（形状、卡池哈希、卡组），拒了发 setup_rejected 的结束广播。
// - 每一步之后每个座位各收一条批次（各自遮过，遮完 events 是空的也发），version 连续；version 不是当前的动作拒 stale，
//   apply 拒的动作拒 invalid，原因原样。
// - 计时到点按座位号依次调 onTimeout，某一步带回新 deadline 就停（Table.timeout 就是这么做的）。
// - 每一步之后问 bot 座位，有动作就等 botDelayMs 再走同一个 apply。
// - 断线宽限到了调 forfeit 判负；恢复时漏掉的批次还在就补发（每个座位留最近 128 条），不在了给当前快照。
// - 可选把房间存进 storage（开发入口用 localStorage）：页面刷新后按动作日志重放回同一个局面，和平台重启 runner 后
//   装回 MatchState 接着打是一回事。
//
// 文件里不碰 DOM：storage 和时钟都由调用方给。
import { PRESET_DECKS } from '../cards';
import type { GameEvent, HeroClass, Side } from '../engine';
import { botMatch, maskMatch, maskMatchEvents, setupMatch } from '../logic/match';
import type { BotLevel, LogEntry, MatchAction, MatchState } from '../logic/state';
import type { ForfeitReason, SeatSpec } from '../logic/types';
import { parseSeats } from '../logic/validate';
import { Table, type Batch, type Seat } from '../server/table';
import type {
  BatchCause,
  BotConfig,
  Created,
  CreateRequest,
  CurrentMatch,
  EndedBroadcast,
  Identity,
  Joined,
  JoinRequest,
  KeyValueStorage,
  LinkBatch,
  LinkEvents,
  LinkEventType,
  MatchLink,
  Rejected,
  SeatConfig,
  SeatsBroadcast,
} from './link';
import { LinkError } from './link';

export type FakeHubOptions = {
  // bot 出手前等多久（平台声明里的 botDelayMs，默认 1 秒）。测试里设 0
  botDelayMs?: number;
  // 建房、进房的延迟，模拟每一局的 runner 睡着、第一次请求要等几秒（online.md 5.7）。默认 0
  connectMs?: number;
  // 建房没带 bots 时，过 joinMs 毫秒自动让一个 bot 坐进 1 号位（开发入口用）。heroClass 不给时随机
  autoBot?: { level: BotLevel; nickname: string; joinMs?: number; heroClass?: HeroClass } | null;
  // 计时到点和断线宽限是否真的开定时器。默认开；测试里关掉，手动调 FakeRoom 的 expire()、forfeit()
  timers?: boolean;
  // 断线宽限（online.md 5.3），默认 60 秒
  graceMs?: number;
  // 存房间的地方，给了就在每一步之后存，建 hub 时装回来
  storage?: KeyValueStorage | null;
  now?: () => number;
  // 开局的种子，默认随机
  seed?: () => number;
};

const STORAGE_KEY = 'lolstone.fakeHub';
// 平台每个座位留最近 128 条批次，用来补发（online.md 4.3）
const HISTORY = 128;
// 单个动作的大小上限（online.md 5.5 第 6 条）
const MAX_ACTION_BYTES = 4096;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type RoomSeat = {
  kind: 'human' | 'bot';
  player: string | null;
  nickname: string | null;
  config: SeatConfig | BotConfig;
  connected: boolean;
  graceUntil: number | null;
  out: boolean;
};

// 这一步怎么来的：Table 发批次时用它给每条批次填 cause 和 requestId
type StepCause = { cause: BatchCause; seat: Side | null; requestId?: string };

// 存进 storage 的房间：局面不存，存种子、座位和动作日志，装回时重放（引擎是确定性的，spec 2.11）
type RoomDump = {
  key: string;
  code: string;
  seed: number;
  seats: RoomSeat[];
  started: boolean;
  log: LogEntry[];
  forfeit: { seat: Side; reason: ForfeitReason } | null;
  deadline: number | null;
};

export class FakeHub {
  readonly botDelayMs: number;
  readonly connectMs: number;
  readonly autoBot: FakeHubOptions['autoBot'];
  readonly timers: boolean;
  readonly graceMs: number;
  readonly now: () => number;
  private readonly seedFn: () => number;
  private readonly storage: KeyValueStorage | null;
  private readonly rooms = new Map<string, FakeRoom>();
  private readonly links = new Set<FakeLink>();
  private readonly nicknames = new Map<string, string>();
  private counter = 0;

  constructor(options: FakeHubOptions = {}) {
    this.botDelayMs = options.botDelayMs ?? 1000;
    this.connectMs = options.connectMs ?? 0;
    this.autoBot = options.autoBot ?? null;
    this.timers = options.timers ?? true;
    this.graceMs = options.graceMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.seedFn = options.seed ?? (() => Math.floor(Math.random() * 2 ** 32));
    this.storage = options.storage ?? null;
    this.restore();
  }

  // 一个主体的连接。同一个主体可以有多个（页面刷新后新建的），消息发给它们全部
  link(player: string): FakeLink {
    const l = new FakeLink(this, player);
    this.links.add(l);
    return l;
  }

  // 按邀请码或对局 key 找房间（测试和开发调试用：模拟断线、计时到点）
  room(codeOrKey: string): FakeRoom | null {
    for (const r of this.rooms.values()) if (r.key === codeOrKey || r.code === codeOrKey) return r;
    return null;
  }

  // 这个主体占着座位、还没结束的房间
  roomOf(player: string): FakeRoom | null {
    for (const r of this.rooms.values()) if (!r.ended && r.seatOf(player) !== null) return r;
    return null;
  }

  nicknameOf(player: string): string | null {
    return this.nicknames.get(player) ?? null;
  }

  // 建房、进房要等 connectMs（模拟 runner 睡着）；别的请求只经过一次异步，和走网络一样
  async wake(cold = false): Promise<void> {
    if (cold && this.connectMs > 0) await sleep(this.connectMs);
    else await Promise.resolve();
  }

  create(player: string, req: CreateRequest): Created {
    if (this.roomOf(player)) throw new LinkError('already_in_match');
    this.nicknames.set(player, req.nickname);
    const key = `m${++this.counter}-${randomCode(4).toLowerCase()}`;
    let code = randomCode(6);
    while (this.room(code)) code = randomCode(6);
    const room = new FakeRoom(this, key, code, this.seedFn() >>> 0);
    this.rooms.set(key, room);
    room.addHuman(player, req.nickname, req.seat);
    for (const bot of req.bots ?? []) room.addBot(bot, null);
    if (!req.bots?.length && this.autoBot) {
      const auto = this.autoBot;
      const add = () => room.addBot({ level: auto.level, heroClass: auto.heroClass ?? randomClass() }, auto.nickname);
      if (this.timers && (auto.joinMs ?? 0) > 0) setTimeout(add, auto.joinMs);
      else add();
    } else room.tryStart();
    this.save();
    return { key, code, seat: 0 };
  }

  join(player: string, code: string, req: JoinRequest): Joined {
    if (this.roomOf(player)) throw new LinkError('already_in_match');
    const room = this.room(code.trim().toUpperCase());
    if (!room || room.ended) throw new LinkError('no_such_match');
    if (room.started || room.seats.length >= 2) throw new LinkError('match_full');
    this.nicknames.set(player, req.nickname);
    const seat = room.addHuman(player, req.nickname, req.seat);
    room.tryStart();
    this.save();
    return { key: room.key, seat };
  }

  // 发给一个主体的所有连接。异步送达（下一个微任务），每条消息各自深拷贝，和走网络一样
  deliver<K extends LinkEventType>(player: string, type: K, msg: LinkEvents[K]): void {
    for (const l of this.links) {
      if (l.player !== player || l.closed) continue;
      const copy = structuredClone(msg);
      queueMicrotask(() => l.emit(type, copy));
    }
  }

  // 只发给一个连接（恢复请求的回复）
  deliverTo<K extends LinkEventType>(link: FakeLink, type: K, msg: LinkEvents[K]): void {
    if (link.closed) return;
    const copy = structuredClone(msg);
    queueMicrotask(() => link.emit(type, copy));
  }

  detach(link: FakeLink): void {
    this.links.delete(link);
  }

  // 房间结束后从 storage 里去掉；结束了的房间还留在内存里，恢复请求照样给最终快照
  save(): void {
    if (!this.storage) return;
    const live = [...this.rooms.values()].filter((r) => !r.ended).map((r) => r.dump());
    try {
      if (live.length === 0) this.storage.removeItem(STORAGE_KEY);
      else this.storage.setItem(STORAGE_KEY, JSON.stringify({ rooms: live, nicknames: [...this.nicknames] }));
    } catch {
      // 存不下就算了，只影响刷新后续局
    }
  }

  private restore(): void {
    if (!this.storage) return;
    let saved: { rooms: RoomDump[]; nicknames: [string, string][] } | null = null;
    try {
      saved = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      saved = null;
    }
    if (!saved) return;
    for (const [p, n] of saved.nicknames ?? []) this.nicknames.set(p, n);
    for (const d of saved.rooms ?? []) {
      const room = FakeRoom.load(this, d);
      if (room) this.rooms.set(room.key, room);
    }
  }
}

export class FakeRoom {
  readonly seats: RoomSeat[] = [];
  table: Table | null = null;
  ended: EndedBroadcast | null = null;
  // 每个座位最近的批次，补发用
  private readonly history: [LinkBatch[], LinkBatch[]] = [[], []];
  private step: StepCause = { cause: 'setup', seat: null };
  private replaying = false;
  private forfeited: RoomDump['forfeit'] = null;
  // setup 时卡组不合规、直接结束的局面（这时没有 Table）
  private finalState: MatchState | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly graceTimers = new Map<Side, ReturnType<typeof setTimeout>>();
  // bot 的动作被 apply 拒了的那一步，这一步之后不再问它（online.md 5.6）
  private readonly botStuck: [number | null, number | null] = [null, null];

  constructor(
    private readonly hub: FakeHub,
    readonly key: string,
    readonly code: string,
    readonly seed: number,
  ) {}

  get started(): boolean {
    return this.table !== null || this.finalState !== null;
  }

  get version(): number {
    return this.table?.version ?? 0;
  }

  seatOf(player: string): Side | null {
    const i = this.seats.findIndex((s) => s.player === player);
    return i < 0 ? null : (i as Side);
  }

  addHuman(player: string, nickname: string, config: SeatConfig): Side {
    // 人类座位按进局先后排，bot 排在最后
    const at = this.seats.findIndex((s) => s.kind === 'bot');
    const seat: RoomSeat = { kind: 'human', player, nickname, config, connected: true, graceUntil: null, out: false };
    if (at < 0) this.seats.push(seat);
    else this.seats.splice(at, 0, seat);
    this.broadcastSeats();
    return this.seatOf(player)!;
  }

  addBot(config: BotConfig, nickname: string | null): void {
    if (this.started || this.ended || this.seats.length >= 2) return;
    this.seats.push({ kind: 'bot', player: null, nickname, config, connected: true, graceUntil: null, out: false });
    this.broadcastSeats();
    this.tryStart();
    this.hub.save();
  }

  // 座位到齐、人类座位都在线时开局（online.md 5.4）
  tryStart(): void {
    if (this.started || this.ended || this.seats.length < 2 || this.seats.some((s) => !s.connected)) return;
    const specs: SeatSpec[] = this.seats.map((s) => ({ kind: s.kind, config: s.config }));
    const setup = setupMatch({ seed: this.seed, seats: specs, options: null });
    if (!setup.ok) {
      this.end({ version: 0, reason: 'setup_rejected', result: null, detail: setup.reason });
      return;
    }
    if (setup.state.game.phase === 'over') {
      // 卡组不合规：已经结束的局面，开局那批就是 game_over
      this.finalState = setup.state;
      this.broadcastSeats();
      this.seats.forEach((_, side) => {
        const s = side as Side;
        this.send(s, { version: 0, seat: s, cause: 'setup', events: maskMatchEvents(setup.events, s), snapshot: maskMatch(setup.state, s), deadlineIn: null });
      });
      this.end({ version: 0, reason: 'result', result: { winner: setup.state.game.winner!, reason: setup.state.reason! } });
      return;
    }
    this.table = this.buildTable(specs);
    this.broadcastSeats();
    this.step = { cause: 'setup', seat: null };
    this.table.start();
    this.afterStep();
  }

  // 一个座位发的动作。version 是客户端发出时看到的 version
  submit(player: string, version: number | null, action: MatchAction, requestId: string): Rejected | null {
    const seat = this.seatOf(player);
    if (seat === null) return { code: 'not_seated', reason: 'not seated' };
    if (this.ended) return { code: 'ended', reason: 'ended' };
    if (!this.table) return { code: 'not_started', reason: 'not started' };
    let size: number;
    try {
      size = JSON.stringify(action)?.length ?? 0;
    } catch {
      return { code: 'bad_envelope', reason: 'not JSON' };
    }
    if (size > MAX_ACTION_BYTES) return { code: 'too_large', reason: 'too large' };
    if (version !== this.table.version) return { code: 'stale', reason: 'stale' };
    this.step = { cause: 'action', seat, requestId };
    const r = this.table.submit(seat, version, action);
    if (!r.ok) return { code: r.reason === 'stale' ? 'stale' : 'invalid', reason: r.reason };
    this.afterStep();
    return null;
  }

  // 计时到点（测试里关了定时器时手动调）
  expire(): void {
    if (!this.table || this.ended || this.table.deadline === null) return;
    this.step = { cause: 'timeout', seat: null };
    this.table.timeout();
    this.afterStep();
  }

  // 平台判负：断线宽限到（abandon）或运营踢人（kicked）
  forfeit(seat: Side, reason: ForfeitReason): void {
    if (!this.table || this.ended) return;
    this.step = { cause: 'forfeit', seat: null };
    const r = this.table.forfeit(seat, reason);
    if (!r.ok) return;
    this.forfeited = { seat, reason };
    this.seats[seat]!.out = true;
    this.seats[seat]!.graceUntil = null;
    this.broadcastSeats();
    this.afterStep();
  }

  // 座位的连接状态变了：断开时开始断线宽限，宽限到了判负；连回来清掉宽限（online.md 5.3）
  setConnected(player: string, connected: boolean): void {
    const seat = this.seatOf(player);
    if (seat !== null) this.setSeatConnected(seat, connected);
  }

  // 按座位号改连接状态。bot 座位没有连接，开发调试时用它模拟"对手断线"（控制台 lolstoneFake.room(邀请码)）
  setSeatConnected(seat: Side, connected: boolean): void {
    const s = this.seats[seat];
    if (!s) return;
    if (s.connected === connected) return;
    s.connected = connected;
    const timer = this.graceTimers.get(seat);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(seat);
    s.graceUntil = null;
    if (!connected && this.table && !this.ended) {
      s.graceUntil = this.hub.now() + this.hub.graceMs;
      if (this.hub.timers) this.graceTimers.set(seat, setTimeout(() => this.forfeit(seat, 'abandon'), this.hub.graceMs));
    }
    this.broadcastSeats();
    if (connected) this.tryStart();
  }

  // 离开：还没开局就放掉座位（建房的人走了房间关掉）；开局后平台不放座位，只算断开；结束了就是走了
  leave(player: string): void {
    const seat = this.seatOf(player);
    if (seat === null) return;
    if (this.ended) return;
    if (this.started) {
      this.setConnected(player, false);
      return;
    }
    if (seat === 0) {
      this.end({ version: 0, reason: 'abandoned', result: null });
      return;
    }
    this.seats.splice(seat, 1);
    this.broadcastSeats();
    this.hub.save();
  }

  // 恢复（online.md 4.3）：since 之后的批次都还在就按顺序补发，否则给一条 cause 为 resume 的当前快照；再补座位广播，
  // 结束了再补结束广播
  // 只回给发请求的那个连接
  resume(link: FakeLink, since: number | null): void {
    const player = link.player;
    const seat = this.seatOf(player);
    if (seat === null) return;
    this.setConnected(player, true);
    if (this.started) {
      const kept = this.history[seat];
      const missed = since === null ? null : kept.filter((b) => b.version > since);
      const complete = missed !== null && (missed.length === 0 ? since === this.version : missed[0]!.version === since! + 1);
      if (complete) for (const b of missed!) this.hub.deliverTo(link, 'batch', b);
      else this.hub.deliverTo(link, 'batch', this.currentFor(seat));
    }
    this.hub.deliverTo(link, 'seats', this.seatsMsg());
    if (this.ended) this.hub.deliverTo(link, 'ended', this.ended);
  }

  // 座位之间的瞬时消息：不经 Table、不存
  message(from: string, type: string, data: unknown, to?: string): void {
    for (const s of this.seats) {
      if (!s.player || s.player === from || (to !== undefined && s.player !== to)) continue;
      this.hub.deliver(s.player, 'message', { type, data, from });
    }
  }

  dump(): RoomDump {
    return {
      key: this.key,
      code: this.code,
      seed: this.seed,
      seats: this.seats.map((s) => ({ ...s })),
      started: this.table !== null,
      log: this.table?.state.log ?? [],
      forfeit: this.forfeited,
      deadline: this.table?.deadline ?? null,
    };
  }

  // 从 storage 装回：建一个同样的 Table，按动作日志重放（不发批次），再接上计时和 bot
  static load(hub: FakeHub, d: RoomDump): FakeRoom | null {
    const room = new FakeRoom(hub, d.key, d.code, d.seed);
    room.seats.push(...d.seats.map((s) => ({ ...s, graceUntil: null, connected: s.kind === 'bot' ? true : s.connected })));
    if (!d.started) return room;
    try {
      const specs: SeatSpec[] = room.seats.map((s) => ({ kind: s.kind, config: s.config }));
      const table = room.buildTable(specs);
      room.table = table;
      room.replaying = true;
      table.start();
      for (const e of d.log) {
        const r = table.submit(e.seat, table.version, e.action);
        if (!r.ok) throw new Error(`replay rejected: ${r.reason}`);
      }
      if (d.forfeit) {
        table.forfeit(d.forfeit.seat, d.forfeit.reason);
        room.forfeited = d.forfeit;
      }
      table.deadline = d.deadline;
    } catch (err) {
      console.warn('[fake] 存的房间装不回来，丢掉', err);
      return null;
    } finally {
      room.replaying = false;
    }
    if (room.table!.result()) return null;
    room.armDeadline();
    room.scheduleBot();
    return room;
  }

  private buildTable(specs: SeatSpec[]): Table {
    const parsed = parseSeats(specs);
    if (!parsed.ok) throw new Error(parsed.reason);
    const [a, b] = parsed.seats;
    // 两个座位都按"真人座位"接进 Table：bot 由这里按平台的节奏驱动（不插 ai_thinking），批次照样每个座位各一条
    const seats = [0, 1].map((side) => ({ kind: 'human', deliver: (batch: Batch) => this.onTableBatch(side as Side, batch) })) as [Seat, Seat];
    return new Table({ seed: this.seed, classes: [a.heroClass, b.heroClass], decks: [a.deck, b.deck], seats, now: this.hub.now });
  }

  // Table 每一步给每个座位发一条批次：补上 seat、cause、requestId，记进这个座位的历史，发给坐在那里的人
  private onTableBatch(side: Side, b: Batch): void {
    if (this.replaying) return;
    const own = this.step.seat === side && this.step.requestId !== undefined;
    const batch: LinkBatch = {
      version: b.version,
      seat: side,
      cause: this.step.cause,
      events: b.events as GameEvent[],
      snapshot: b.snapshot,
      deadlineIn: b.deadlineIn,
      ...(own ? { requestId: this.step.requestId } : {}),
    };
    this.send(side, batch);
  }

  private send(side: Side, batch: LinkBatch): void {
    const h = this.history[side];
    h.push(batch);
    if (h.length > HISTORY) h.shift();
    const player = this.seats[side]?.player;
    if (player) this.hub.deliver(player, 'batch', batch);
  }

  // 恢复时给的当前快照
  private currentFor(seat: Side): LinkBatch {
    const snapshot = this.table ? this.table.snapshotFor(seat) : maskMatch(this.finalState!, seat);
    const deadline = this.table?.deadline ?? null;
    const deadlineIn = deadline === null || this.ended ? null : Math.max(0, deadline - this.hub.now());
    return { version: this.version, seat, cause: 'resume', events: [], snapshot, deadlineIn };
  }

  // 每一步之后：有结果就发结束广播；否则重设计时器、问 bot；存一下
  private afterStep(): void {
    const result = this.table?.result() ?? null;
    if (result) {
      this.end({ version: this.version, reason: 'result', result });
      return;
    }
    this.armDeadline();
    this.scheduleBot();
    this.hub.save();
  }

  private end(msg: EndedBroadcast): void {
    if (this.ended) return;
    this.ended = msg;
    this.clearTimers();
    for (const s of this.seats) if (s.player) this.hub.deliver(s.player, 'ended', msg);
    this.hub.save();
  }

  private clearTimers(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.deadlineTimer = null;
    this.botTimer = null;
  }

  private armDeadline(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    const deadline = this.table?.deadline ?? null;
    if (!this.hub.timers || deadline === null || this.ended) return;
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      this.expire();
    }, Math.max(0, deadline - this.hub.now()));
  }

  // 每一步之后问 bot 座位（按座位号），有动作就等 botDelayMs 再执行；一次只处理一个 bot 动作。
  // 等的期间局面可能变了（计时到点），执行时按当时的局面再问一次
  private scheduleBot(): void {
    if (this.botTimer || this.ended || !this.table) return;
    const seat = this.botToAct();
    if (seat === null) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.playBot(seat);
    }, this.hub.botDelayMs);
  }

  private botToAct(): Side | null {
    const table = this.table!;
    for (const side of [0, 1] as const) {
      if (this.seats[side]?.kind !== 'bot' || this.botStuck[side] === table.version) continue;
      if (this.botAction(side)) return side;
    }
    return null;
  }

  private playBot(seat: Side): void {
    if (this.ended || !this.table) return;
    const action = this.botAction(seat);
    if (action) {
      this.step = { cause: 'bot', seat };
      const r = this.table.submit(seat, this.table.version, action);
      if (r.ok) {
        this.afterStep();
        return;
      }
      this.botStuck[seat] = this.table.version;
    }
    this.scheduleBot();
  }

  // 逻辑模块的 bot()：Table 自己的 MatchState 里 bots 都是 null（单机的 AI 座位不走它），这里按座位的 config 补上等级
  private botAction(seat: Side): MatchAction | null {
    const levels = this.seats.map((s) => (s.kind === 'bot' ? (s.config as BotConfig).level : null)) as [BotLevel | null, BotLevel | null];
    return botMatch({ ...this.table!.state, bots: levels }, seat);
  }

  private seatsMsg(): SeatsBroadcast {
    const now = this.hub.now();
    return {
      version: this.version,
      started: this.started,
      seats: this.seats.map((s, i) => ({
        seat: i as Side,
        kind: s.kind,
        player: s.player,
        nickname: s.nickname,
        connected: s.connected,
        graceIn: s.graceUntil === null ? null : Math.max(0, s.graceUntil - now),
        out: s.out,
      })),
    };
  }

  private broadcastSeats(): void {
    const msg = this.seatsMsg();
    for (const s of this.seats) if (s.player) this.hub.deliver(s.player, 'seats', msg);
  }
}

// 一个主体对假平台的连接，实现 MatchLink。version 是这个连接收到的最新批次的 version，发动作时带上
export class FakeLink implements MatchLink {
  closed = false;
  private version: number | null = null;
  private requests = 0;
  private readonly handlers = new Map<LinkEventType, Set<(msg: never) => void>>();

  constructor(
    readonly hub: FakeHub,
    readonly player: string,
  ) {}

  async identity(): Promise<Identity> {
    await this.hub.wake();
    return { player: this.player, nickname: this.hub.nicknameOf(this.player) };
  }

  async currentMatch(): Promise<CurrentMatch | null> {
    await this.hub.wake();
    const room = this.hub.roomOf(this.player);
    if (!room) return null;
    return { key: room.key, code: room.started ? null : room.code, seat: room.seatOf(this.player)!, started: room.started };
  }

  async createMatch(req: CreateRequest): Promise<Created> {
    await this.hub.wake(true);
    this.version = null;
    return this.hub.create(this.player, structuredClone(req));
  }

  async joinMatch(code: string, req: JoinRequest): Promise<Joined> {
    await this.hub.wake(true);
    this.version = null;
    return this.hub.join(this.player, code, structuredClone(req));
  }

  async leave(): Promise<void> {
    await Promise.resolve();
    this.hub.roomOf(this.player)?.leave(this.player);
    this.version = null;
  }

  async submit(action: MatchAction): Promise<Rejected | null> {
    // 和 SDK 一样，发出时带上已收到的 version；到平台要经过一次异步，这期间计时到点就会撞车拒 stale
    const version = this.version;
    const requestId = `r${++this.requests}`;
    let copy: MatchAction;
    try {
      copy = structuredClone(action);
    } catch {
      return { code: 'bad_envelope', reason: 'not JSON' };
    }
    await Promise.resolve();
    const room = this.hub.roomOf(this.player) ?? null;
    if (!room) return { code: 'not_seated', reason: 'not seated' };
    return room.submit(this.player, version, copy, requestId);
  }

  async resume(since: number | null): Promise<void> {
    await this.hub.wake();
    this.hub.roomOf(this.player)?.resume(this, since);
  }

  send(type: string, data: unknown, to?: string): void {
    this.hub.roomOf(this.player)?.message(this.player, type, structuredClone(data), to);
  }

  on<K extends LinkEventType>(type: K, handler: (msg: LinkEvents[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as (msg: never) => void);
    return () => set.delete(handler as (msg: never) => void);
  }

  emit<K extends LinkEventType>(type: K, msg: LinkEvents[K]): void {
    if (this.closed) return;
    if (type === 'batch') this.version = (msg as LinkBatch).version;
    for (const h of [...(this.handlers.get(type) ?? [])]) (h as (m: LinkEvents[K]) => void)(msg);
  }

  // 模拟关掉标签页：平台发现断开，开始断线宽限
  disconnect(): void {
    this.closed = true;
    this.hub.roomOf(this.player)?.setConnected(this.player, false);
    this.hub.detach(this);
  }
}

function randomCode(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function randomClass(): HeroClass {
  const classes = Object.keys(PRESET_DECKS) as HeroClass[];
  return classes[Math.floor(Math.random() * classes.length)]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
