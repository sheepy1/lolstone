// 联机的流程（docs/online.md 3.3、3.4）：主菜单的联机面板 → 建房或进房 → 等待页 → 加载页 → 对局 → 结算。
// 对着 MatchLink 接口写；按需加载，不进首包。现在只有开发和测试用的假平台（地址带 ?online=fake），平台的适配以后接在
// openLink 里。
//
// 这一局的第一条批次（开局，或者刷新页面后恢复的当前快照）一到就建 RemoteMatch，之后的批次它自己订阅；
// 对局层的状态变化（计时、对手在线状态）同步到界面状态 ui.online.match，倒计时和断线横幅读它。
import { PRESET_DECKS } from '../cards';
import { poolHash } from '../cards/poolHash';
import type { HeroClass, Side } from '../engine';
import type { EndedBroadcast, LinkBatch, MatchLink, SeatConfig, SeatsBroadcast } from '../net/link';
import { LinkError } from '../net/link';
import { deckProblems, matchDecks } from '../ui/decks';
import { RemoteMatch } from './remoteMatch';
import type { AppShell } from './shell';
import { getUi, setUi, subscribeUi, type OnlineMatchUi, type OnlineUi } from './store';

// 昵称存在这里（online.md 5.4），进局时交给平台，对手从座位广播里看到
const NICKNAME_KEY = 'lolstone.player';
const NICKNAME_MAX = 12;
// 自动驾驶时一局结束后停多久再开下一局
const AUTOPLAY_NEXT_MS = 1500;

export function initialOnlineUi(): OnlineUi {
  return { nickname: loadNickname(), open: false, busy: false, notice: null, pending: null, room: null, match: null };
}

// 联机用哪个平台。现在只有开发用的假平台：建房后 1 号位自动坐进一个 L1 bot，出手前等 1 秒；房间存在 localStorage，
// 刷新页面能续上。没有可用的平台时返回 null，主菜单不显示联机入口
export async function openLink(params: URLSearchParams): Promise<MatchLink | null> {
  if (params.get('online') !== 'fake') return null;
  const { FakeHub } = await import('../net/fakeLink');
  const autoplay = params.has('autoplay');
  const hub = new FakeHub({
    botDelayMs: 1000,
    connectMs: 600,
    autoBot: { level: 'L1', nickname: '练习机器人', joinMs: autoplay ? 300 : 1500 },
    storage: safeStorage(),
  });
  // 调试入口（控制台 lolstoneFake）：lolstoneFake.room(邀请码) 拿到房间，能模拟对手断线（setSeatConnected）、
  // 判负（forfeit）、计时到点（expire）。window.lolstone 是对局控制，载入时会被换掉，所以单独放
  (window as unknown as { lolstoneFake: unknown }).lolstoneFake = hub;
  return hub.link(fakePlayerId());
}

export class OnlineClient {
  private match: RemoteMatch | null = null;
  private seats: SeatsBroadcast | null = null;
  // 在等一局开始（建房、进房、续局之后）。上一局离开后晚到的批次和广播不算新的一局
  private expecting = false;
  private autoplay = false;
  private games = 0;
  private nextGame: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly shell: AppShell,
    private readonly link: MatchLink,
  ) {
    link.on('batch', (b) => this.onFirstBatch(b));
    link.on('seats', (s) => this.onSeats(s));
    link.on('ended', (e) => this.onEnded(e));
  }

  // 主菜单打开时问平台有没有没打完的局（online.md 3.3 续局）
  async init(): Promise<void> {
    try {
      const [me, current] = await Promise.all([this.link.identity(), this.link.currentMatch()]);
      const nickname = loadNickname() || me.nickname || '';
      patchOnline({ nickname, pending: current ? { started: current.started, code: current.code } : null });
    } catch (err) {
      console.warn('[online] 连不上平台', err);
    }
  }

  get inMatch(): boolean {
    return this.match !== null;
  }

  setNickname(name: string): void {
    const nickname = name.slice(0, NICKNAME_MAX);
    patchOnline({ nickname, notice: null });
    try {
      localStorage.setItem(NICKNAME_KEY, nickname);
    } catch {
      // 存不了就只在这次用
    }
  }

  // 建房：职业和卡组用主菜单选的（预组或自组），先用 validateDeck 查一遍
  async create(): Promise<void> {
    const seat = this.seatConfig();
    if (!seat) return;
    this.enterWaiting(null);
    try {
      const created = await this.link.createMatch({ nickname: this.nickname(), seat });
      if (this.cancelledMeanwhile()) return;
      if (getUi().screen === 'waiting' && !this.match) patchOnline({ room: { code: created.code, joined: false } });
    } catch (err) {
      this.backToMenu(errorText(err));
    }
  }

  async join(code: string): Promise<void> {
    const seat = this.seatConfig();
    if (!seat) return;
    const c = code.trim().toUpperCase();
    if (!c) {
      patchOnline({ notice: '先输入邀请码' });
      return;
    }
    this.enterWaiting(c);
    try {
      await this.link.joinMatch(c, { nickname: this.nickname(), seat });
      this.cancelledMeanwhile();
    } catch (err) {
      this.backToMenu(errorText(err));
    }
  }

  // 等待页的取消：放掉座位回主菜单
  async cancel(): Promise<void> {
    await this.link.leave().catch((err: unknown) => console.warn('[online] 离开失败', err));
    this.backToMenu(null);
  }

  // 续上没打完的局：开局了就要当前快照（第一条批次到了自动进对局），还在等人就回等待页
  async resumePending(): Promise<void> {
    const pending = getUi().online?.pending;
    if (!pending) return;
    patchOnline({ pending: null });
    if (!pending.started) this.enterWaiting(pending.code);
    else patchOnline({ busy: true });
    this.expecting = true;
    try {
      await this.link.resume(null);
    } catch (err) {
      this.backToMenu(errorText(err));
    }
  }

  // 离开没打完的局：开局了平台不放座位（online.md 5.4），先认输
  async leavePending(): Promise<void> {
    const pending = getUi().online?.pending;
    if (!pending) return;
    patchOnline({ pending: null });
    if (pending.started) {
      // 动作要带当前的 version：刷新页面后还没收到过批次，先恢复一下拿到当前快照再认输；和计时到点撞车就再发
      const resumed = nextBatch(this.link);
      await this.link.resume(null).catch(() => {});
      await resumed;
      for (let i = 0; i < 3; i++) {
        const r = await this.link.submit({ kind: 'concede' }).catch(() => null);
        if (r?.code !== 'stale') break;
      }
    }
    await this.link.leave().catch(() => {});
  }

  // 对局菜单的"回主菜单"：联机里等于认输（online.md 3.4）
  leaveMatch(): void {
    this.match?.concede();
    this.finish();
  }

  // 结算面板：再来一局就是再建一个房间，回主菜单就是离开
  again(): void {
    this.finish();
    void this.create();
  }

  toMenu(): void {
    this.finish();
  }

  // 自动驾驶（地址带 ?online=fake&autoplay）：有没打完的局就续上，没有就建房；一局结束后自动开下一局
  startAutoplay(): void {
    this.autoplay = true;
    if (!getUi().online?.nickname) this.setNickname('自动驾驶');
    subscribeUi(() => {
      const ui = getUi();
      if (!this.autoplay || !ui.result || this.nextGame || !this.match) return;
      this.games++;
      console.info(`[online] 第 ${this.games} 局结束：${ui.result.won ? '胜' : ui.result.winner === 'draw' ? '平' : '负'}（${ui.result.reason}），${ui.result.turns} 回合`);
      this.nextGame = setTimeout(() => {
        this.nextGame = null;
        this.again();
      }, AUTOPLAY_NEXT_MS);
    });
    if (getUi().online?.pending) void this.resumePending();
    else void this.create();
  }

  // 离开这一局（已经结束，或者刚认输）：断开对局、回主菜单
  private finish(): void {
    this.match?.stop();
    this.match = null;
    this.seats = null;
    this.expecting = false;
    void this.link.leave().catch(() => {});
    void this.shell.load().then((game) => game.backToMenu());
    patchOnline({ match: null, room: null, busy: false });
  }

  private nickname(): string {
    return getUi().online?.nickname.trim() || '召唤师';
  }

  private seatConfig(): SeatConfig | null {
    const { humanClass, humanDeck } = getUi().menu;
    const { mine } = matchDecks(humanClass, humanClass, humanDeck);
    const problems = deckProblems(mine.cards, humanClass);
    if (problems.length > 0) {
      patchOnline({ notice: `卡组不能用：${problems[0]}` });
      return null;
    }
    return { heroClass: humanClass, deck: [...mine.cards], poolHash: poolHash() };
  }

  // 建房、进房的请求还在路上时玩家已经取消了：请求到了平台照样占了座位，这里再离开一次，不留一个没人管的座位
  private cancelledMeanwhile(): boolean {
    if (this.expecting || this.match) return false;
    void this.link.leave().catch(() => {});
    return true;
  }

  private enterWaiting(code: string | null): void {
    this.seats = null;
    this.expecting = true;
    patchOnline({ open: false, busy: false, notice: null, room: { code, joined: false }, match: null });
    setUi({ screen: 'waiting', error: null });
  }

  private backToMenu(notice: string | null): void {
    this.expecting = false;
    patchOnline({ room: null, busy: false, notice, open: notice !== null });
    if (getUi().screen === 'waiting') setUi({ screen: 'menu' });
  }

  private onSeats(s: SeatsBroadcast): void {
    if (!this.expecting) return;
    this.seats = s;
    const room = getUi().online?.room;
    if (room && s.seats.length >= 2) patchOnline({ room: { ...room, joined: true } });
  }

  // 这一局的第一条批次：建 RemoteMatch，进加载页。之后的批次 RemoteMatch 自己收
  private onFirstBatch(b: LinkBatch): void {
    if (this.match || !this.expecting || (b.cause !== 'setup' && b.cause !== 'resume')) return;
    this.expecting = false;
    const match = new RemoteMatch(this.link, b, this.seats);
    this.match = match;
    const classes = [0, 1].map((i) => b.snapshot.game.players[i]!.heroClass) as [HeroClass, HeroClass];
    const side = match.side;
    const { humanDeck } = getUi().menu;
    const decks = [0, 1].map((i) =>
      i === side ? [...matchDecks(classes[side], classes[side], humanDeck).mine.cards] : [...(PRESET_DECKS[classes[i]!] ?? [])],
    ) as [string[], string[]];
    patchOnline({ room: null, busy: false, pending: null, match: this.matchUi(match, classes[side], classes[other(side)]) });
    match.onChange = () => {
      void this.shell.load().then((game) => game.refresh());
      this.syncMatch();
    };
    match.onResync = (view) => void this.shell.load().then((game) => game.resync(view));
    void this.shell
      .load()
      .then((game) => {
        if (this.match !== match) return;
        if (this.autoplay) game.autoplay(true);
        return game.startOnline(match, classes, decks);
      })
      .catch((err: unknown) => {
        console.error(err);
        setUi({ error: `进入对局失败：${(err as Error).message}` });
      });
  }

  // 对局没开起来就结束了（建房的人走了、setup 拒了）：回主菜单说明原因。开局后的结束由结算面板处理
  private onEnded(e: EndedBroadcast): void {
    if (this.match || !this.expecting) return;
    if (e.reason === 'setup_rejected') {
      const text = e.detail === 'version_mismatch' ? '游戏版本和对手不一致，刷新页面后再试' : `开局失败：${e.detail ?? e.reason}`;
      this.backToMenu(text);
    } else if (getUi().screen === 'waiting') this.backToMenu('房间已关闭');
  }

  private matchUi(match: RemoteMatch, myClass: HeroClass, opponentClass: HeroClass): OnlineMatchUi {
    const opp = match.opponent;
    return {
      myClass,
      opponentClass,
      opponent: opp?.nickname ?? '对手',
      phase: match.visible.phase,
      deadline: match.deadline,
      graceUntil: opp && !opp.out ? opp.graceUntil : null,
    };
  }

  private syncMatch(): void {
    const m = this.match;
    const cur = getUi().online?.match;
    if (!m || !cur) return;
    const next = this.matchUi(m, cur.myClass, cur.opponentClass);
    if (JSON.stringify(next) !== JSON.stringify(cur)) patchOnline({ match: next });
  }
}

// 下一条批次到了（或者等了 5 秒还没到）
function nextBatch(link: MatchLink): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, 5000);
    const off = link.on('batch', done);
    function done(): void {
      clearTimeout(timer);
      off();
      resolve();
    }
  });
}

function patchOnline(patch: Partial<OnlineUi>): void {
  setUi((s) => (s.online ? { online: { ...s.online, ...patch } } : {}));
}

function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

function errorText(err: unknown): string {
  const code = err instanceof LinkError ? err.code : null;
  if (code === 'no_such_match') return '没有这个房间，检查一下邀请码';
  if (code === 'match_full') return '这个房间已经满了';
  if (code === 'already_in_match') return '你还有一局没打完';
  console.error('[online]', err);
  return '连不上服务器，稍后再试';
}

function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

// 假平台的匿名主体：同一个浏览器稳定（存在 localStorage），和平台的做法一样
function fakePlayerId(): string {
  const key = 'lolstone.fakePlayer';
  try {
    const id = localStorage.getItem(key) ?? `p-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 10)}`;
  }
}
