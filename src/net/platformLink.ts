// 托管平台的 MatchLink 实现（docs/online.md 3.3、4.3）：包平台 SDK 逻辑模式的对局对象（sdkTypes.d.ts 的 LogicMatch），
// 把它的建局、进局、发动作、批次、座位广播、结束广播、瞬时消息、恢复翻译成 src/net/link.ts 的形状。
// RemoteMatch 和联机界面只认那个接口，这里是唯一碰 SDK 的地方。
//
// - SDK 按需加载：构造时只拿一个 sdk() 函数（online.ts 里动态插 <script>，测试里给一个假的全局对象），第一次用到平台时才调。
// - 身份是 SDK 给的匿名主体（平台按 cookie 认，同一个浏览器稳定）；昵称走建局、进局请求的 nickname 字段。
// - version、在途动作的 id、跳号补发、断线重连后的恢复请求都是 SDK 自己做的。SDK 一次只许一个在途动作，上一个没回包时
//   再发会抛 busy；认输不受 RemoteMatch 的在途锁管，所以这里等上一个回包再发。
// - 平台没有"我正占着哪一局"的接口：当前对局的 key 记在 storage 里，主菜单问 currentMatch 时按 key 重新进局（有座位的主体
//   再进同一局只是换凭据，不改座位），对局结束、离开、进不去时清掉。记的时候按主体分开：本地 runner 用地址参数把同一个
//   浏览器的几个标签页派生成几个主体，它们共用一份 localStorage。
// - 对局结束后平台关局（SDK 的 closed）：没有先到结束广播的关局（等人超时、空局）翻译成 reason 为 abandoned 的结束广播。
// - record()：平台声明了对局结束后导出时拿整局记录（online.md 第 7 节）；结束广播到了平台可能还没关局，拿到 match_not_ended
//   就隔半秒再试几次。
//
// 文件里不碰 DOM：storage 和 SDK 的加载都由调用方给。
import type { GameEvent, Side } from '../engine';
import type { MatchAction, MatchResult, Snapshot } from '../logic/state';
import type {
  Created,
  CreateRequest,
  CurrentMatch,
  EndedBroadcast,
  EndedReason,
  Identity,
  Joined,
  JoinRequest,
  KeyValueStorage,
  LinkBatch,
  LinkEvents,
  LinkEventType,
  MatchLink,
  MatchRecord,
  OpenMatch,
  RecordStep,
  Rejected,
  RejectCode,
  SeatsBroadcast,
} from './link';
import { LinkError } from './link';
import type * as Sdk from './sdkTypes';

export type PlatformLinkOptions = {
  // 拿到 SDK 的全局对象。第一次用到平台时调一次，失败了下次再调
  sdk: () => Promise<Sdk.MedeoGlobal>;
  // 记当前对局 key 的地方（浏览器里传 localStorage），不给就不记，刷新页面后续不上
  storage?: KeyValueStorage | null;
  now?: () => number;
};

type Match = Sdk.LogicMatch<Snapshot, GameEvent>;
type Api = { sdk: Sdk.MedeoGlobal; medeo: Sdk.Medeo };

// storage 里记当前对局 key 的键，值是 JSON：{ 主体 id: 对局 key }
export const CURRENT_MATCH_KEY = 'lolstone.platformMatch';
// 进局后等第一条座位广播多久：SDK 订上通道就发恢复请求，平台先回座位广播；本地 runner 刚起来要等它领到这一局
const SEATS_WAIT_MS = 8000;
// 续局时等平台回当前快照多久
const RESUME_WAIT_MS = 15_000;
// 认输要等上一个动作回包（SDK 一次只许一个在途），最多等多久；SDK 自己 10 秒没回音就结算成 timeout
const IDLE_WAIT_MS = 10_000;
const IDLE_POLL_MS = 50;
// 结束广播到了平台可能还没关局：整局记录拿到 match_not_ended 时隔多久再试、试几次
const RECORD_RETRY_MS = 500;
const RECORD_RETRIES = 6;

const ENDED_REASONS = new Set<string>(['result', 'forfeit', 'abandoned', 'module_error', 'setup_rejected']);
const END_REASONS = new Set<string>(['game', 'concede', 'timeout', 'abandon', 'kicked', 'invalid_deck']);

export class PlatformLink implements MatchLink {
  private api: Promise<Api> | null = null;
  // 现在包着的对局对象。结束、关局后留着（record 还要用），下一次建房、进房、续局时换掉
  private match: Match | null = null;
  private offMatch: (() => void)[] = [];
  private readonly handlers = new Map<LinkEventType, Set<(msg: never) => void>>();
  private readonly storage: KeyValueStorage | null;
  private readonly now: () => number;
  private requests = 0;
  // 最近一次发出的动作的 requestId：SDK 只说批次是不是自己的（mine），不带 id，这里补上
  private lastRequestId: string | null = null;
  // 这一局收到过结束广播（之后的关局不再补一条）
  private endedSeen = false;

  constructor(private readonly options: PlatformLinkOptions) {
    this.storage = options.storage ?? null;
    this.now = options.now ?? Date.now;
  }

  // 现在包着的 SDK 对局对象（控制台调试用：看 version、seats、connection）
  get current(): Match | null {
    return this.match;
  }

  async identity(): Promise<Identity> {
    // 平台不记上次的昵称，昵称由调用方自己存
    return { player: await this.subject(), nickname: null };
  }

  async currentMatch(): Promise<CurrentMatch | null> {
    if (this.match && !this.match.ended) return this.describe(this.match);
    // 没记过任何对局就不碰 SDK（它按需加载）；记过的要先问平台我是谁，再查记的是不是我的
    const subject = Object.keys(this.storedKeys()).length > 0 ? await this.subject() : null;
    const key = subject === null ? null : this.storedKeys()[subject];
    if (!subject || !key) return null;
    let match: Match;
    try {
      match = await this.open((games) => games.joinMatch(key, { authority: 'logic' }));
    } catch (err) {
      // 房间已关、已结束：记的 key 过期了
      if (err instanceof LinkError && (err.code === 'no_such_match' || err.code === 'match_full')) {
        this.forget(subject);
        return null;
      }
      throw err;
    }
    const current = await this.describe(match);
    if (!current) this.forget(subject);
    return current;
  }

  async createMatch(req: CreateRequest): Promise<Created> {
    this.assertFree();
    const match = await this.open(
      (games) =>
        games.createMatch({
          authority: 'logic',
          seat: req.seat,
          ...(req.bots?.length ? { bots: req.bots } : {}),
          ...(req.public ? { visibility: 'public' } : {}),
        }),
      req.nickname,
    );
    return { key: match.key, code: match.code, seat: 0 };
  }

  async joinMatch(code: string, req: JoinRequest): Promise<Joined> {
    this.assertFree();
    const match = await this.open((games) => games.joinByCode(code.trim().toUpperCase(), { authority: 'logic', seat: req.seat }), req.nickname);
    const seats = match.seats ?? (await this.firstSeats(match));
    const mine = seats?.seats.find((s) => s.player === match.me.id);
    // 两个座位的房间，进房的人是 1 号位；座位广播还没到就按这个填
    return { key: match.key, seat: (mine?.seat ?? 1) as Side };
  }

  async leave(): Promise<void> {
    const match = this.match;
    this.detach();
    if (match) this.forget(match.me.id);
    if (match && !match.ended) await match.leave().catch((err: unknown) => console.warn('[platform] 离开失败', err));
  }

  async submit(action: MatchAction): Promise<Rejected | null> {
    const match = this.match;
    if (!match || match.ended) return { code: 'not_seated', reason: 'not seated' };
    if (!(await this.idle(match))) return { code: 'unavailable', reason: 'previous action still in flight' };
    const requestId = `r${++this.requests}`;
    this.lastRequestId = requestId;
    let result: Sdk.SubmitResult;
    try {
      result = await match.submit(action);
    } catch (err) {
      // 动作不是 JSON（bad_request）或者还是在途（busy，等过了还没回包）
      return { code: codeOf(err) === 'busy' ? 'unavailable' : 'bad_envelope', reason: (err as Error).message };
    }
    if (result.ok) return null;
    const code: RejectCode = result.code === 'timeout' ? 'unavailable' : result.code;
    const rejected: Rejected = { code, reason: result.reason ?? result.code };
    this.emit('rejected', { ...rejected, requestId, version: result.version ?? 0 });
    return rejected;
  }

  // since 不用：SDK 自己记 version、自己补跳号。这里只负责"要一份当前的局面"：有对局对象就向平台要当前快照，
  // 没有（刷新页面）就按记的 key 重新进局，SDK 订上通道时自己发恢复请求，座位广播、当前快照、结束广播从 on 里到
  async resume(since: number | null): Promise<void> {
    void since;
    if (this.match && !this.match.ended) {
      await withTimeout(this.match.resume(), RESUME_WAIT_MS);
      return;
    }
    const key = this.storedKeys()[await this.subject()];
    if (!key) throw new LinkError('no_such_match');
    await this.open((games) => games.joinMatch(key, { authority: 'logic' }));
  }

  send(type: string, data: unknown, to?: string): void {
    if (!this.match || this.match.ended) return;
    try {
      this.match.send(type, data, to === undefined ? {} : { to });
    } catch (err) {
      console.warn('[platform] 瞬时消息没发出去', err);
    }
  }

  on<K extends LinkEventType>(type: K, handler: (msg: LinkEvents[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as (msg: never) => void);
    return () => set.delete(handler as (msg: never) => void);
  }

  // 公开列表里有人在等、还有空位的房间。没人的房是建房的人放掉的，平台过一阵才关，不算
  async listOpen(): Promise<OpenMatch[]> {
    const { sdk, medeo } = await this.load();
    const items = await sdk.games(medeo).listMatches().catch(unavailable);
    return items
      .filter((m) => m.players > 0 && m.players < m.capacity)
      .map((m) => ({ key: m.key, code: m.code, createdAt: m.createdAt }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async record(): Promise<MatchRecord | null> {
    const match = this.match;
    if (!match) return null;
    for (let attempt = 0; ; attempt++) {
      try {
        return toRecord(await match.record());
      } catch (err) {
        const code = codeOf(err);
        if (code === 'match_not_ended' && attempt < RECORD_RETRIES) {
          await sleep(RECORD_RETRY_MS);
          continue;
        }
        // match_not_found 是没声明导出（或者这一局没开过局），不算错
        if (code !== 'match_not_found') console.warn('[platform] 拿不到整局记录', err);
        return null;
      }
    }
  }

  // 平台认的我是谁（匿名主体）。云端的回答是平铺的（SDK 的 Viewer 类型），本地 runner 回的是没拍平的 { viewer: { subject } }，
  // 两种都认
  private async subject(): Promise<string> {
    const { medeo } = await this.load();
    const viewer = (await medeo.viewer().catch(unavailable)) as Sdk.Viewer & { viewer?: { subject?: unknown } };
    const subject = typeof viewer.subject === 'string' ? viewer.subject : viewer.viewer?.subject;
    if (typeof subject !== 'string' || !subject) {
      console.error('[platform] 平台的回答里没有主体', viewer);
      throw new LinkError('unavailable');
    }
    return subject;
  }

  private load(): Promise<Api> {
    if (!this.api) {
      // 不用 SDK 的本机模式（localhost 上默认开）：那是房主模式用 BroadcastChannel 在标签页之间玩的，身份是每个标签页随机的；
      // 这里永远对着真平台（云端或本地 runner）说话，身份要平台认的那个，公开列表也要平台的
      const loading = this.options.sdk().then((sdk) => ({ sdk, medeo: sdk.init({ local: false }) }));
      loading.catch(() => {
        if (this.api === loading) this.api = null;
      });
      this.api = loading;
    }
    return this.api.catch(unavailable);
  }

  // 还占着一局（主菜单问过 currentMatch 拿到的那局）时不能再建房、进房，和平台的规则一致（online.md 5.4）
  private assertFree(): void {
    if (this.match && !this.match.ended && !this.match.result) throw new LinkError('already_in_match');
  }

  private async open(run: (games: Sdk.Games) => Promise<Sdk.LogicMatch>, nickname?: string): Promise<Match> {
    const { sdk, medeo } = await this.load();
    const games = sdk.games(medeo, nickname ? { nickname } : {});
    let match: Match;
    try {
      match = (await run(games)) as Match;
    } catch (err) {
      throw linkError(err);
    }
    this.attach(match);
    return match;
  }

  // 这个主体在这一局里占着的座位；不在座位上、已判负、已结束时为 null
  private async describe(match: Match): Promise<CurrentMatch | null> {
    const seats = match.seats ?? (await this.firstSeats(match));
    if (!seats || match.result || match.ended) return null;
    const mine = seats.seats.find((s) => s.player === match.me.id);
    if (!mine || mine.out) return null;
    return { key: match.key, code: seats.started ? null : match.code, seat: mine.seat as Side, started: seats.started };
  }

  private firstSeats(match: Match): Promise<Sdk.LogicSeats | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(null);
      }, SEATS_WAIT_MS);
      const off = match.on('seats', (s) => {
        clearTimeout(timer);
        off();
        resolve(s);
      });
    });
  }

  // 等 SDK 里在途的动作回包
  private idle(match: Match): Promise<boolean> {
    if (!match.busy) return Promise.resolve(true);
    const started = this.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (!match.busy) resolve(true);
        else if (this.now() - started > IDLE_WAIT_MS) resolve(false);
        else setTimeout(tick, IDLE_POLL_MS);
      };
      setTimeout(tick, IDLE_POLL_MS);
    });
  }

  private attach(match: Match): void {
    this.detach();
    this.match = match;
    this.endedSeen = false;
    this.remember(match.me.id, match.key);
    this.offMatch = [
      match.on('batch', (b) => this.onBatch(b)),
      match.on('seats', (s) => this.emit('seats', toSeats(s))),
      match.on('ended', (e) => {
        this.endedSeen = true;
        this.forget(match.me.id);
        this.emit('ended', toEnded(e));
      }),
      match.on('message', (m) => this.emit('message', m)),
      match.on('connection', (status) => {
        if (status !== 'online') console.warn(`[platform] 连接${status === 'offline' ? '断开' : '中断，正在重连'}`);
      }),
      match.on('closed', ({ reason }) => this.onClosed(match, reason)),
    ];
  }

  private detach(): void {
    for (const off of this.offMatch) off();
    this.offMatch = [];
    this.match = null;
  }

  private onBatch(b: Sdk.LogicBatch<Snapshot, GameEvent>): void {
    if (!b.snapshot) {
      // 回合制的局每条批次都带快照（online.md 4.3）
      console.error('[platform] 批次没有快照，丢掉', b);
      return;
    }
    const batch: LinkBatch = {
      version: b.version,
      seat: b.seat as Side,
      cause: b.cause === 'tick' ? 'action' : b.cause,
      events: b.events,
      snapshot: b.snapshot,
      deadlineIn: b.deadlineIn,
      ...(b.mine ? { requestId: this.lastRequestId ?? 'mine' } : {}),
    };
    this.emit('batch', batch);
  }

  // 平台关局：对局结束后的关局前面已经有结束广播；等人超时、空局这些没有，补一条 abandoned 的
  private onClosed(match: Match, reason: string): void {
    this.forget(match.me.id);
    if (!this.endedSeen) {
      this.endedSeen = true;
      this.emit('ended', { version: 0, reason: 'abandoned', result: null, detail: reason });
    }
  }

  private emit<K extends LinkEventType>(type: K, msg: LinkEvents[K]): void {
    for (const h of [...(this.handlers.get(type) ?? [])]) (h as (m: LinkEvents[K]) => void)(msg);
  }

  private storedKeys(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(CURRENT_MATCH_KEY) ?? '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private remember(subject: string, key: string): void {
    this.saveKeys({ ...this.storedKeys(), [subject]: key });
  }

  private forget(subject: string): void {
    const keys = this.storedKeys();
    if (!(subject in keys)) return;
    delete keys[subject];
    this.saveKeys(keys);
  }

  private saveKeys(keys: Record<string, string>): void {
    try {
      if (Object.keys(keys).length === 0) this.storage?.removeItem(CURRENT_MATCH_KEY);
      else this.storage?.setItem(CURRENT_MATCH_KEY, JSON.stringify(keys));
    } catch {
      // 存不了就只是刷新后续不上
    }
  }
}

function toSeats(s: Sdk.LogicSeats): SeatsBroadcast {
  return {
    version: s.version ?? 0,
    started: s.started,
    seats: s.seats.map((x) => ({
      seat: x.seat as Side,
      kind: x.kind,
      player: x.player,
      nickname: x.nickname,
      connected: x.connected,
      graceIn: x.graceIn,
      out: x.out,
    })),
  };
}

function toEnded(e: Sdk.LogicEnded): EndedBroadcast {
  // 平台以后加的 reason 原样透传，界面按"房间已关闭"处理
  const reason = (ENDED_REASONS.has(e.reason) ? e.reason : 'abandoned') as EndedReason;
  if (!ENDED_REASONS.has(e.reason)) console.warn(`[platform] 不认识的结束原因 ${e.reason}`);
  return { version: e.version ?? 0, reason, result: toResult(e.result), ...(e.detail !== undefined ? { detail: e.detail } : {}) };
}

// 结束广播的 result 就是逻辑模块 result() 的返回值（online.md 4.1），形状不对就当没有
function toResult(r: unknown): MatchResult | null {
  if (typeof r !== 'object' || r === null) return null;
  const { winner, reason } = r as { winner?: unknown; reason?: unknown };
  if (winner !== 0 && winner !== 1 && winner !== 'draw') return null;
  if (typeof reason !== 'string' || !END_REASONS.has(reason)) return null;
  return { winner, reason: reason as MatchResult['reason'] };
}

function toRecord(r: Sdk.MatchRecord): MatchRecord {
  return {
    seed: r.seed,
    options: r.options,
    seats: r.seats.map(({ kind, config }) => ({ kind, config })),
    actions: r.actions.map((step) => {
      const out: RecordStep = { seat: step.seat as Side | null, action: step.action as MatchAction | null, at: step.at, source: step.source };
      if (step.source === 'forfeit') out.reason = step.reason;
      return out;
    }),
    result: toResult(r.result),
  };
}

function codeOf(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

// SDK 的错误码翻译成接口的（link.ts 的 LinkError）：没有对应的原样透传，界面按"连不上服务器"处理并把原错误记到控制台
function linkError(err: unknown): LinkError {
  const code = codeOf(err);
  switch (code) {
    case 'match_not_found':
    case 'match_closed':
      return new LinkError('no_such_match');
    case 'match_full':
    case 'match_started':
      return new LinkError('match_full');
    case 'already_in_match':
    case 'unavailable':
      return new LinkError(code);
    default:
      console.error('[platform]', err);
      return new LinkError(code ?? 'unavailable');
  }
}

function unavailable(err: unknown): never {
  console.error('[platform] 连不上平台', err);
  throw new LinkError('unavailable');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new LinkError('unavailable')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
