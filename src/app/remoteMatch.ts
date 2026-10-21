// 联机对局的客户端座位（docs/online.md 3.3）：对着 src/net/link.ts 的 MatchLink 写，平台的适配在接口后面。
// 权威对局在平台的 runner 里，这里只有平台发来的遮过的快照：
// - 合法操作在快照上算；导演在播、不轮到我、有一个动作已发出还没回包时锁定。一次只允许一个在途动作。
// - submit 先在快照上 checkAction，不合法直接返回原因、不发送；合法就发出去，不改本地任何东西，等批次。
// - 批次到了更新 visible、version、deadline，把事件交给导演。对手的动作一批批到，自然就是对手的节奏，没有 ai_thinking。
// - 动作被拒（和计时到点撞车的 stale、apply 拒了的 invalid）解除在途、控制台记警告；其余拒绝码是缺陷，报错。
//   例外是换牌阶段的 stale：双方同时提交换牌时后到的那条被拒，而换牌动作在新 version 上仍然合法（对手的换牌不改我的手牌），
//   所以等下一条批次更新 version 后把同一个动作自动重发一次，玩家不用再点；只重发一次，再被拒就按上面处理。
// - 页面刷新后的第一条批次是 cause 为 resume 的当前快照：用 viewFromState 建场景，不回放历史。
// - 座位广播更新对手的昵称和在场状态，结束广播给出结果的原因。都不进导演队列。
import { checkAction, listLegalActions, type Action, type GameState, type Side } from '../engine';
import type { EndReason, MatchAction, MatchResult } from '../logic/state';
import type { EndedBroadcast, LinkBatch, MatchLink, Rejected, SeatInfo, SeatsBroadcast } from '../net/link';
import type { Director } from '../presentation/director';
import type { PresentationEvent } from '../presentation/events';
import { initialView, viewFromState, type ViewState } from '../presentation/viewState';
import type { MatchSeat } from './seat';

// 对手的状态（界面横幅、加载页、结算面板用）。graceUntil 是断线判负的到期时刻（本地时钟）：在线为 null；断线但平台的广播
// 没带宽限（runner 重启后恢复的广播是这样）也为 null，这时判负由平台做、界面显示"正在判定"
export type Opponent = { nickname: string | null; kind: 'human' | 'bot'; connected: boolean; graceUntil: number | null; out: boolean };

// 动作被拒 stale 后怎么办：none 解除在途；now 马上再发（认输，任何 version 上都合法）；next_version 等 version 更新后重发一次（换牌）
type Retry = 'none' | 'now' | 'next_version';

export class RemoteMatch implements MatchSeat {
  readonly side: Side;
  readonly initial: ViewState;
  // 平台发来的遮过的快照
  visible: GameState;
  // 已收到的最新一步
  version: number;
  // 当前计时的到期时刻（本地时钟，deadlineIn 加收到时的时间），没有计时为 null
  deadline: number | null;
  opponent: Opponent | null = null;
  // 结束广播（对局结束后到）
  ended: EndedBroadcast | null = null;
  // 每批事件交给导演之前调用（对局日志用）
  onBatch: ((events: PresentationEvent[], state: GameState) => void) | null = null;
  // 局面以外的状态变了（在途动作被拒、计时、对手在线状态、结束广播），界面要刷新
  onChange: (() => void) | null = null;
  // 断线期间漏掉了事件、只拿到当前快照时调用：界面用这个显示局面重建场景、重新接上导演
  onResync: ((view: ViewState) => void) | null = null;
  private reason: EndReason | null;
  private director: Director | null = null;
  // 导演接上之前到的事件（加载页期间），接上时按顺序交给它
  private pending: PresentationEvent[][] = [];
  // 在途的动作：发出时的 version。收到更新的批次或被拒时解除
  private inflight: { version: number } | null = null;
  // 换牌撞车被拒 stale、等着重发的动作：version 超过 after 的批次到了就发。等的期间输入照样锁定
  private resend: { action: MatchAction; after: number } | null = null;
  private readonly unsubscribe: (() => void)[];
  private readonly now: () => number;

  // first 是这一局收到的第一条批次：开局（cause 为 setup）或刷新页面后恢复的当前快照（cause 为 resume）
  constructor(
    private readonly link: MatchLink,
    first: LinkBatch,
    seats: SeatsBroadcast | null = null,
    now: () => number = Date.now,
  ) {
    this.now = now;
    this.side = first.seat;
    this.visible = first.snapshot.game;
    this.reason = first.snapshot.reason;
    this.version = first.version;
    this.deadline = toDeadline(first.deadlineIn, now);
    if (first.cause === 'resume') {
      this.initial = viewFromState(this.visible, this.side);
    } else {
      // 开局：和单机一样，手牌由开局那批的 mulligan_start 发到手里
      this.initial = initialView(this.visible, this.side);
      if (first.events.length > 0) this.pending.push(first.events);
    }
    if (seats) this.applySeats(seats);
    this.unsubscribe = [
      link.on('batch', (b) => this.receive(b)),
      link.on('seats', (s) => {
        this.applySeats(s);
        this.onChange?.();
      }),
      link.on('ended', (e) => {
        this.ended = e;
        this.onChange?.();
      }),
    ];
  }

  get over(): boolean {
    return this.visible.phase === 'over' || this.ended !== null;
  }

  // 结束广播带的 result 优先；它还没到时从快照里读（快照的 reason 在对局结束那一批里已填）
  get result(): MatchResult | null {
    if (this.ended?.result) return this.ended.result;
    const g = this.visible;
    if (g.phase !== 'over' || g.winner === undefined) return null;
    return { winner: g.winner, reason: this.reason ?? 'game' };
  }

  // 有一个动作已发出、还没回包（或者撞车后等着重发）
  get waiting(): boolean {
    return this.inflight !== null || this.resend !== null;
  }

  start(director: Director): void {
    this.director = director;
    const queued = this.pending;
    this.pending = [];
    for (const events of queued) director.enqueue(events);
  }

  humanToAct(): boolean {
    const s = this.visible;
    if (this.ended) return false;
    if (s.phase === 'mulligan') return !s.players[this.side].mulliganDone;
    return s.phase === 'playing' && s.current === this.side;
  }

  legalActions(): Action[] | null {
    if (!this.director || this.director.busy || this.waiting || !this.humanToAct()) return null;
    return listLegalActions(this.visible, this.side);
  }

  submit(action: Action): string | null {
    if (!this.legalActions()) return 'input locked';
    const err = checkAction(this.visible, action);
    if (err) return err;
    // 换牌阶段双方同时提交会撞车（online.md 4.4）：被拒 stale 就等新批次到了重发一次。对局阶段的 stale 不重发
    this.send(action, this.visible.phase === 'mulligan' && action.kind === 'mulligan' ? 'next_version' : 'none');
    return null;
  }

  // 认输：发逻辑模块的认输动作，等带 game_over 的批次，表现层照常播失败演出。不管有没有在途动作都发；
  // 和别的动作撞车被拒 stale 时再发一次
  concede(): void {
    if (this.over) return;
    this.send({ kind: 'concede' }, 'now');
  }

  stop(): void {
    for (const off of this.unsubscribe) off();
    this.director = null;
    this.onBatch = null;
    this.onChange = null;
    this.onResync = null;
  }

  private send(action: MatchAction, retry: Retry): void {
    const token = { version: this.version };
    if (action.kind !== 'concede') this.inflight = token;
    this.link
      .submit(action)
      .then((rejected) => {
        if (rejected) this.rejected(action, rejected, token, retry);
      })
      .catch((err: unknown) => {
        console.error('[online] 发动作失败', action, err);
        this.release(token);
      });
  }

  private rejected(action: MatchAction, r: Rejected, token: { version: number }, retry: Retry): void {
    if (r.code === 'stale' || r.code === 'invalid') console.warn(`[online] 动作被拒（${r.code}）`, action, r.reason);
    else console.error(`[online] 动作被拒（${r.code}）`, action, r.reason);
    if (r.code === 'stale' && !this.over) {
      if (retry === 'now') {
        this.send(action, 'now');
        return;
      }
      if (retry === 'next_version') {
        // 被拒说明平台已经执行了别的一步：那一步的批次可能先到了（adopt 已经解除在途、version 已更新），也可能还在路上。
        // 先记下要重发的再解除在途：release 会通知界面刷新，这时 waiting 仍为真，输入不会放开
        this.resend = { action, after: token.version };
        this.release(token);
        this.flushResend();
        return;
      }
    }
    this.release(token);
  }

  // 撞车后的重发：version 更新了、还在换牌阶段、我还没提交、动作在新快照上仍然合法才发。只发这一次（retry 为 none），
  // 再被拒就按普通的被拒处理。局面变了（比如计时到点替我交了）就不发，等着重发的动作丢掉
  private flushResend(): void {
    const r = this.resend;
    if (!r || this.version <= r.after) return;
    this.resend = null;
    if (this.inflight || this.visible.phase !== 'mulligan' || !this.humanToAct() || checkAction(this.visible, r.action) !== null) return;
    console.info('[online] 换牌和对手同时提交，按新 version 重发', r.action);
    this.send(r.action, 'none');
    this.onChange?.();
  }

  // 解除在途（只解除这一个动作的；之后又发了新动作的不动）
  private release(token: { version: number }): void {
    if (this.inflight !== token) return;
    this.inflight = null;
    this.onChange?.();
  }

  private receive(b: LinkBatch): void {
    if (b.seat !== this.side) return;
    if (b.cause === 'resume') {
      // 断线重连后平台给的当前快照：局面没变就只更新计时；变了的话已经漏掉了事件，显示局面接不上，交给界面重建场景
      this.deadline = toDeadline(b.deadlineIn, this.now);
      if (b.version !== this.version) {
        this.adopt(b);
        this.onResync?.(viewFromState(this.visible, this.side));
      }
      this.onChange?.();
      return;
    }
    // 重复的（补发时和已收到的重叠）不要
    if (b.version <= this.version) return;
    this.adopt(b);
    this.onBatch?.(b.events, this.visible);
    if (this.director) this.director.enqueue(b.events);
    else if (b.events.length > 0) this.pending.push(b.events);
    this.onChange?.();
  }

  private adopt(b: LinkBatch): void {
    this.visible = b.snapshot.game;
    this.reason = b.snapshot.reason;
    this.version = b.version;
    this.deadline = toDeadline(b.deadlineIn, this.now);
    // 任何新的一步都让在途的动作有了结果：是它自己就执行了，不是它（计时到点抢先）它会被拒 stale
    if (this.inflight && b.version > this.inflight.version) this.inflight = null;
    this.flushResend();
  }

  private applySeats(s: SeatsBroadcast): void {
    const opp: SeatInfo | undefined = s.seats.find((x) => x.seat !== this.side);
    if (!opp) return;
    const prev = this.opponent;
    // 断线中的广播没带宽限（平台 runner 重启后恢复的广播是这样）：沿用上一条的到期时刻，倒计时不跳没；之前也没有就是 null
    const graceUntil = opp.connected ? null : opp.graceIn !== null ? this.now() + opp.graceIn : prev && !prev.connected ? prev.graceUntil : null;
    this.opponent = { nickname: opp.nickname, kind: opp.kind, connected: opp.connected, graceUntil, out: opp.out };
  }
}

function toDeadline(deadlineIn: number | null, now: () => number): number | null {
  return deadlineIn === null ? null : now() + deadlineIn;
}
