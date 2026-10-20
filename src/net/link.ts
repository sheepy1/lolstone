// 客户端和托管平台之间的接口（docs/online.md 3.3、4.3）：RemoteMatch 和联机界面只认这个接口，不认平台的 SDK。
// 两个实现：真平台 src/net/platformLink.ts（包平台 SDK 的对局对象），开发和测试用的进程内假平台 src/net/fakeLink.ts。
//
// 消息的形状照 4.3：每一步之后每个座位各收一条批次（各自遮过，version 连续）；座位广播带昵称和在场状态；
// 结束广播带 result() 的返回值；动作被拒带拒绝码。具体的消息名和字段名以平台 SDK 为准，适配层负责翻译成这里的形状。
import type { GameEvent, HeroClass, Side } from '../engine';
import type { BotLevel, MatchAction, MatchResult, Snapshot } from '../logic/state';
import type { ForfeitReason } from '../logic/types';

// 记当前对局、存房间用的键值存储（浏览器里传 localStorage）
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

// 人类座位建房、进房时交给平台的座位 config（online.md 4.1、5.4）。只在平台和 runner 里，不发给任何客户端
export type SeatConfig = { heroClass: HeroClass; deck: string[]; poolHash: string };

// bot 座位的 config（online.md 4.1、5.6）：不给 deck 用这个职业的预组
export type BotConfig = { level: BotLevel; heroClass: HeroClass; deck?: string[] };

// 平台给的匿名主体（online.md 5.4）：同一个浏览器稳定。nickname 是上次进局时交的昵称，没有为 null
export type Identity = { player: string; nickname: string | null };

// 这个主体正占着座位的、没打完的局（online.md 3.3 续局、5.4）。started 为 false 时还在等人
export type CurrentMatch = { key: string; code: string | null; seat: Side; started: boolean };

// public 为 true 的房间在平台的公开列表里（listOpen），自动驾驶的两个标签页靠它找到对方；默认只凭邀请码进
export type CreateRequest = { nickname: string; seat: SeatConfig; bots?: BotConfig[]; public?: boolean };
export type JoinRequest = { nickname: string; seat: SeatConfig };
export type Created = { key: string; code: string; seat: Side };
export type Joined = { key: string; seat: Side };
// 公开列表里还有空位的房间，按建房时间从早到晚排
export type OpenMatch = { key: string; code: string; createdAt: string };

// 整局记录（online.md 第 7 节）：平台在对局结束后导出，seed 加逐条动作就能重放。每一步的 source 说它从哪来：玩家或 bot 的
// 动作带 action，计时到点和判负是平台发起的、action 为 null、seat 是被替的那个座位；at 是平台记的时间
export type RecordStep = {
  seat: Side | null;
  action: MatchAction | null;
  at: string;
  source: 'action' | 'bot' | 'timeout' | 'forfeit' | 'tick';
  reason?: ForfeitReason;
};
export type MatchRecord = {
  seed: number;
  options: unknown;
  seats: { kind: 'human' | 'bot'; config: unknown }[];
  actions: RecordStep[];
  result: MatchResult | null;
};

// 批次（online.md 4.3）：这一步怎么来的
export type BatchCause = 'setup' | 'action' | 'timeout' | 'bot' | 'forfeit' | 'resume';

// 发给一个座位的一条批次。events 和 snapshot 都按这个座位遮过；deadlineIn 是距计时到期还有几毫秒，没有计时为 null。
// requestId 只在这一步是这个座位自己的动作时有。cause 为 resume 时是恢复时补的当前快照，不是新的一步，events 为空
export type LinkBatch = {
  version: number;
  seat: Side;
  cause: BatchCause;
  events: GameEvent[];
  snapshot: Snapshot;
  deadlineIn: number | null;
  requestId?: string;
};

// 座位广播里的一个座位。player 是平台的主体 id（bot 为 null），graceIn 是断线判负前剩的毫秒数（在线为 null），
// out 是已被判负或踢出。座位的 config 永远不在这里
export type SeatInfo = { seat: Side; kind: 'human' | 'bot'; player: string | null; nickname: string | null; connected: boolean; graceIn: number | null; out: boolean };
export type SeatsBroadcast = { version: number; started: boolean; seats: SeatInfo[] };

// 结束广播（online.md 4.3）。result 是逻辑模块 result() 的返回值；abandoned、module_error、setup_rejected 没有 result
export type EndedReason = 'result' | 'forfeit' | 'abandoned' | 'module_error' | 'setup_rejected';
export type EndedBroadcast = { version: number; reason: EndedReason; result: MatchResult | null; detail?: string };

// 动作被拒（online.md 4.3）。stale 和 invalid 是正常会发生的（和计时到点撞车、apply 拒了），其余是客户端或 SDK 的缺陷，
// 或者平台暂时不可用
export type RejectCode = 'stale' | 'invalid' | 'rate_limited' | 'too_large' | 'bad_envelope' | 'not_seated' | 'not_started' | 'ended' | 'module_error' | 'unavailable';
export type Rejected = { code: RejectCode; reason: string };
export type Rejection = Rejected & { requestId: string; version: number };

// 座位之间的瞬时消息（online.md 4.3）：不经 runner、不存、不保证送达。from 是发件人的主体 id
export type LinkMessage = { type: string; data: unknown; from: string };

export type LinkEvents = {
  batch: LinkBatch;
  seats: SeatsBroadcast;
  ended: EndedBroadcast;
  message: LinkMessage;
  rejected: Rejection;
};

export type LinkEventType = keyof LinkEvents;

// 建房、进房、恢复失败时抛出的错误，code 是平台的错误码：already_in_match（这个主体已经占着一局的座位，online.md 5.4）、
// no_such_match（邀请码不对或房间已关）、match_full、unavailable（连不上平台）
export class LinkError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'LinkError';
  }
}

export interface MatchLink {
  // 平台给的匿名主体和上次用的昵称
  identity(): Promise<Identity>;
  // 有没有没打完的局（主菜单提示续上还是离开）
  currentMatch(): Promise<CurrentMatch | null>;
  // 建房：建房的人是 0 号位，bots 里的 bot 排在人类座位后面。返回邀请码和对局 key。座位都到齐、都在线时平台开局，
  // 开局那批（cause 为 setup）和开局的座位广播从 on 里到
  createMatch(req: CreateRequest): Promise<Created>;
  // 凭邀请码进房
  joinMatch(code: string, req: JoinRequest): Promise<Joined>;
  // 离开当前对局。还没开局就放掉座位；开局后平台不放座位（online.md 5.4），调用方要先认输
  leave(): Promise<void>;
  // 发一个动作，version 由接口自己带。被拒返回拒绝码和原因，执行了返回 null（这一步的批次从 on('batch') 到）
  submit(action: MatchAction): Promise<Rejected | null>;
  // 恢复：since 是已收到的 version。漏掉的批次还在就按顺序补发，不在了（或 since 为 null）给一条 cause 为 resume
  // 的当前快照；同时补发当前的座位广播，对局已结束再补结束广播
  resume(since: number | null): Promise<void>;
  // 发瞬时消息，to 是收件人的主体 id，不给发给同局所有人
  send(type: string, data: unknown, to?: string): void;
  // 订阅消息，返回取消订阅的函数
  on<K extends LinkEventType>(type: K, handler: (msg: LinkEvents[K]) => void): () => void;
  // 可选：公开列表里还有空位的房间，按建房时间从早到晚排（自动驾驶用）。没有公开列表的平台不实现
  listOpen?(): Promise<OpenMatch[]>;
  // 可选：刚结束的这一局的整局记录（online.md 第 7 节）。平台没声明导出、对局没结束时返回 null
  record?(): Promise<MatchRecord | null>;
}
