// 拷自平台 SDK（逻辑模式的客户端），版本 0a6d92a，不要手改：平台改了接口就按新版本整份重拷，改这个版本号。
// 只放类型，不 import 平台仓的任何路径。只拷了 lolstone 用到的部分：核心（init、viewer）、games 的逻辑局（建局、进局、
// LogicMatch）、错误码、整局记录；房主模式的 Match、realtime 没拷。
//
// 平台 SDK 是页面从应用自己的 host 按需加载的单文件脚本 /_medeo/sdk/v1.js，挂在全局对象 Medeo 上（MedeoGlobal）。
// 逻辑模块那一侧的契约（Logic、Step、SetupContext）在 src/logic/types.ts，这里不重复。
import type { Logic } from '../logic/types';

// ---- errors ----

export type MedeoErrorCode =
  // 任何能力
  | 'capability_disabled'
  | 'sign_in_required'
  | 'scope_not_granted'
  | 'rate_limited'
  | 'bad_request'
  // games
  | 'multiplayer_disabled'
  | 'too_many_matches'
  | 'match_not_found'
  | 'match_closed'
  | 'match_full'
  | 'protocol_mismatch'
  // 一个主体在一个应用里同时只占一局的座位
  | 'already_in_match'
  // 逻辑局
  | 'logic_unavailable'
  | 'bots_unsupported'
  | 'match_started'
  | 'match_not_ended'
  // SDK 自己的
  | 'not_host'
  | 'bad_type'
  | 'state_too_large'
  /** 回合制逻辑局里上一个动作还在途时调 submit() */
  | 'busy'
  | 'app_identity_disabled'
  | 'app_token_refused'
  | 'unavailable';

/** 每个方法的 Promise 失败和同步抛错都是它 */
export interface MedeoError extends Error {
  readonly name: 'MedeoError';
  readonly code: MedeoErrorCode;
}

// ---- 核心 ----

/** `/_medeo/me` 的回答 */
export interface Viewer {
  kind: 'anonymous' | 'user';
  /** 匿名观众是 `v_…`，登录后是 `u_…` */
  subject: string;
  scopes: string[];
  profile: { name: string; avatarUrl?: string } | null;
  previous_subject: string | null;
  app: {
    appKey: string;
    capabilities: {
      realtime: boolean;
      games: boolean;
      viewer_sign_in: boolean;
    };
  };
}

export interface MedeoOptions {
  /** 本机模式：不连平台，同一个浏览器的别的标签页就是别的观众。localhost 上默认开；逻辑局不受它影响，照样走平台的接口 */
  local?: boolean;
  /** 别人看到的名字，进局时没另给就用它 */
  nickname?: string;
  /** 平台接口的地址，默认是页面 origin 加 /_medeo */
  baseUrl?: string;
}

export interface Medeo {
  readonly local: boolean;
  /** 这个页面的观众是谁（GET /_medeo/me）。第一次调给浏览器一个匿名身份 */
  viewer(): Promise<Viewer>;
}

/** 长连接的状态 */
export type ConnectionStatus = 'online' | 'reconnecting' | 'offline';

// ---- games：建局、进局 ----

export interface CreateOptions {
  capacity?: number;
  visibility?: 'public' | 'unlisted';
  meta?: unknown;
}

/** listMatches() 的一项：公开的、还开着的局 */
export interface MatchSummary {
  key: string;
  code: string;
  capacity: number;
  visibility: 'public' | 'unlisted';
  protocol: number;
  meta: unknown;
  /** 已经坐下的人数 */
  players: number;
  createdAt: string;
}

/** 平台的 runner 替这一局跑逻辑模块时 createMatch 的参数 */
export interface LogicCreateOptions extends CreateOptions {
  authority: 'logic';
  /** 交给模块 setup 的 ctx.options；JSON，不超过 4 KiB */
  options?: unknown;
  /** 自己座位的 config（卡组、职业……），只有 runner 看得到 */
  seat?: unknown;
  /** 每个 bot 座位一个 config；模块要导出 bot */
  bots?: unknown[];
}

export interface LogicJoinOptions {
  authority: 'logic';
  seat?: unknown;
}

export interface GamesOptions {
  /** 消息格式的版本号，不填是 1；不同的人进不了同一局 */
  protocol?: number;
  /** 别人看到的名字，默认取 init 的 */
  nickname?: string;
}

// `any` 是为了让任何 State、Event 的 Logic 都能匹配
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLogic = Logic<any, any>;

/** 模块 apply 接的 State */
export type StateOf<L> = L extends { apply(state: infer S, seat: number, action: unknown): unknown } ? S : unknown;

/** mask 返回什么。模块把它写成 unknown 时退回 State（遮完通常还是 State 的形状） */
export type SnapshotOf<L> = L extends { mask(state: never, seat: number): infer M } ? (unknown extends M ? StateOf<L> : M) : unknown;

/** maskEvents 返回的数组的元素 */
export type EventOf<L> = L extends { maskEvents(events: never, seat: number): Array<infer E> } ? E : unknown;

/** 按模块的类型给出的逻辑局：createMatch<typeof logic>。不给模块类型时 snapshot 和 events 是 unknown */
export type LogicMatchOf<L extends AnyLogic | undefined> = L extends AnyLogic ? LogicMatch<SnapshotOf<L>, EventOf<L>> : LogicMatch;

export interface Games {
  /** 公开的、还开着的局 */
  listMatches(): Promise<MatchSummary[]>;
  /** 建局并进去。authority 为 logic 时平台的 runner 替它跑逻辑模块 */
  createMatch<L extends AnyLogic | undefined = undefined>(options: LogicCreateOptions): Promise<LogicMatchOf<L>>;
  /** 同一个 Medeo 上已经开着的局再进一次拿到的是同一个对象 */
  joinMatch<L extends AnyLogic | undefined = undefined>(key: string, options: LogicJoinOptions): Promise<LogicMatchOf<L>>;
  joinByCode<L extends AnyLogic | undefined = undefined>(code: string, options: LogicJoinOptions): Promise<LogicMatchOf<L>>;
}

// ---- games：整局记录 ----

/**
 * 声明了 record: 'after_end' 的局结束后能拿到的整局记录。每一步的 source 说它从哪来；平台自己发起的步 action 是 null，
 * timeout 和 forfeit 带座位号（重放时按座位调 onTimeout、forfeit），只有 tick 是 seat: null
 */
export interface MatchRecord {
  seed: number;
  options: unknown;
  seats: Array<{ kind: 'human' | 'bot'; config: unknown }>;
  actions: RecordStep[];
  result: unknown;
}

export type RecordStep =
  | { seat: number; action: unknown; at: string; source: 'action' | 'bot' }
  | { seat: number; action: null; at: string; source: 'timeout' }
  | { seat: number; action: null; at: string; source: 'forfeit'; reason: 'abandon' | 'kicked' }
  | { seat: null; action: null; at: string; source: 'tick'; tick: number };

// ---- games：逻辑局的协议形状 ----

export type BatchCause = 'setup' | 'action' | 'timeout' | 'bot' | 'forfeit' | 'tick' | 'resume';

/**
 * 这个座位看到的一步。snapshot 是 mask(state, seat)：回合制的局每条都带，tick 的局每秒至少一条带。
 * mine 为 true 表示这一步是这个客户端自己的动作
 */
export interface LogicBatch<Snapshot = unknown, Event = unknown> {
  version: number;
  seat: number;
  cause: BatchCause;
  events: Event[];
  snapshot?: Snapshot;
  /** 收到时离计时到点还有几毫秒；没有计时是 null */
  deadlineIn: number | null;
  mine: boolean;
}

export interface LogicSeat {
  seat: number;
  kind: 'human' | 'bot';
  /** 坐着的玩家 id；空座位和 bot 座位是 null */
  player: string | null;
  nickname: string | null;
  connected: boolean;
  /** 断线的座位离判负还剩几毫秒；在线是 null */
  graceIn: number | null;
  /** 已判负或被踢：它的动作被拒 not_seated */
  out: boolean;
}

export interface LogicSeats {
  /** 开局前是 null */
  version: number | null;
  started: boolean;
  seats: LogicSeat[];
  /** runner 没说时不带 */
  ticksPerSecond?: number | null;
}

/**
 * reason 是 result、forfeit、abandoned、setup_rejected、module_error，或者平台以后加的；
 * result 在 reason 为 result 时是模块 result(state) 的返回值，detail 在 setup_rejected 时是模块给的原因
 */
export interface LogicEnded {
  version: number | null;
  reason: string;
  result: unknown;
  detail?: string;
}

/** runner 的拒绝码 */
export type RejectCode = 'stale' | 'invalid' | 'rate_limited' | 'too_large' | 'bad_envelope' | 'not_seated' | 'not_started' | 'ended' | 'module_error' | 'unavailable';

/** timeout 是 SDK 自己的：10 秒没有回音。动作可能已经执行了，恢复请求带回的批次会说明 */
export type SubmitResult =
  | { ok: true; version: number }
  | {
      ok: false;
      code: RejectCode | 'timeout';
      reason?: string;
      version: number | null;
    };

// ---- games：逻辑局的对局对象 ----

export interface LogicMatchEvents<S, E> {
  batch: [LogicBatch<S, E>];
  seats: [LogicSeats];
  ended: [LogicEnded];
  message: [{ type: string; data: unknown; from: string }];
  connection: [ConnectionStatus];
  /** 这局关了：之后这个对象不能再用 */
  closed: [{ reason: string }];
}

/**
 * 一局由平台的 runner 当权威的对局。SDK 自己管：version（丢掉重复的、缺了的向 runner 要补发）、回合制里一次一个在途动作、
 * 每次订上通道时的恢复请求
 */
export interface LogicMatch<Snapshot = unknown, Event = unknown> {
  readonly authority: 'logic';
  readonly key: string;
  readonly code: string;
  readonly capacity: number;
  readonly meta: unknown;
  readonly me: { id: string; name: string };
  /** 自己的座位号；runner 说了之前是 null */
  readonly seat: number | null;
  /** 最新一条批次的 version；第一条到之前是 null */
  readonly version: number | null;
  /** 这个座位收到的最新快照 */
  readonly snapshot: Snapshot | undefined;
  readonly latest: LogicBatch<Snapshot, Event> | null;
  /** 按本页时钟算的计时到期时刻；没有计时是 null */
  readonly deadline: number | null;
  readonly seats: LogicSeats | null;
  /** 怎么结束的；没结束是 null */
  readonly result: LogicEnded | null;
  /** 发出去的动作还没回包 */
  readonly busy: boolean;
  readonly connection: ConnectionStatus;
  /** 已经退订：所有持有者都离开了，或者被平台关了 */
  readonly ended: boolean;
  on<K extends keyof LogicMatchEvents<Snapshot, Event>>(name: K, fn: (...args: LogicMatchEvents<Snapshot, Event>[K]) => void): () => void;
  /**
   * 把动作发给 runner。resolve 成它产生的 version 或被拒的原因，从不 reject；stale 要等让它过时的那条批次到了才 resolve。
   * 回合制里上一个动作还在途时抛 busy，动作不是 JSON 时抛 bad_request
   */
  submit(action: unknown): Promise<SubmitResult>;
  /** 发给别的座位（或某一个玩家）的瞬时消息，runner 不看 */
  send(type: string, data?: unknown, options?: { to?: string }): void;
  /** 要一份完整的当前快照。resolve 成那条批次；还没开局或已结束时是 null */
  resume(): Promise<LogicBatch<Snapshot, Event> | null>;
  /** 整局记录；只有声明了 record: 'after_end' 的模块有 */
  record(): Promise<MatchRecord>;
  /** 离开。开局后座位不放：这一局结束了这个玩家才能进别的局 */
  leave(): Promise<void>;
}

// ---- 全局对象 ----

/** 单文件脚本 /_medeo/sdk/v1.js 挂在 globalThis.Medeo 上的东西（lolstone 用到的部分） */
export interface MedeoGlobal {
  init(options?: MedeoOptions): Medeo;
  games(medeo: Medeo, options?: GamesOptions): Games;
  readonly MedeoError: new (code: MedeoErrorCode, message?: string) => MedeoError;
}
