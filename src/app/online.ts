// 联机的流程（docs/online.md 3.3、3.4）：主菜单的联机面板 → 建房或进房 → 等待页 → 加载页 → 对局 → 结算。
// 对着 MatchLink 接口写；按需加载，不进首包。两个实现：真平台（src/net/platformLink.ts，包平台 SDK，SDK 脚本在第一次用到时
// 才从应用自己的 host 加载）和开发、测试用的假平台（src/net/fakeLink.ts，地址带 ?online=fake）。
//
// 这一局的第一条批次（开局，或者刷新页面后恢复的当前快照）一到就建 RemoteMatch，之后的批次它自己订阅；
// 对局层的状态变化（计时、对手在线状态）同步到界面状态 ui.online.match，倒计时和断线横幅读它。
// 地址带 ?bot（或 ?bot=L0）时建房带一个 bot 座位（online.md 5.6）：一个人对 bot 打，冒烟用的开关，练习入口的界面是 M6c 的事。
import { PRESET_DECKS } from '../cards';
import { poolHash } from '../cards/poolHash';
import type { HeroClass, Side } from '../engine';
import type { BotConfig, EndedBroadcast, LinkBatch, MatchLink, SeatConfig, SeatsBroadcast } from '../net/link';
import { LinkError } from '../net/link';
import type { MedeoGlobal } from '../net/sdkTypes';
import { deckProblems, matchDecks } from '../ui/decks';
import { RemoteMatch } from './remoteMatch';
import type { AppShell } from './shell';
import { getUi, setUi, subscribeUi, type OnlineMatchUi, type OnlineUi } from './store';

// 昵称存在这里（online.md 5.4），进局时交给平台，对手从座位广播里看到
const NICKNAME_KEY = 'lolstone.player';
const NICKNAME_MAX = 12;
// 自动驾驶时一局结束后停多久再开下一局
const AUTOPLAY_NEXT_MS = 1500;
// 自动驾驶的 1 号位等 0 号位建好下一个房间：每隔多久看一次公开列表、最多看几次
const AUTOPLAY_POLL_MS = 1000;
const AUTOPLAY_POLLS = 30;

export function initialOnlineUi(): OnlineUi {
  return { nickname: loadNickname(), open: false, busy: false, notice: null, pending: null, room: null, match: null };
}

// 地址带 ?bot 时建房带的 bot 座位：等级是参数的值（L0 或 L1，默认 L1），职业随机
export function practiceBots(params: URLSearchParams): BotConfig[] | null {
  if (!params.has('bot')) return null;
  const level = params.get('bot') === 'L0' ? 'L0' : 'L1';
  const classes = Object.keys(PRESET_DECKS) as HeroClass[];
  return [{ level, heroClass: classes[Math.floor(Math.random() * classes.length)]! }];
}

// 联机用哪个平台（online.md 3.3）：
// - 地址带 ?online=fake：开发用的假平台。建房后 1 号位自动坐进一个 L1 bot，出手前等 1 秒；房间存在 localStorage，刷新页面能续上。
// - 否则接真平台：sdkUrl 是 shell.ts 探到的 SDK 脚本地址，第一次用到平台时才插 <script> 加载，生产首包不带。
// 没有可用的平台时返回 null，主菜单不显示联机入口
export async function openLink(params: URLSearchParams, sdkUrl: string | null): Promise<MatchLink | null> {
  if (params.get('online') === 'fake') return openFakeLink(params);
  if (!sdkUrl) return null;
  const { PlatformLink } = await import('../net/platformLink');
  const link = new PlatformLink({ sdk: () => loadSdk(sdkUrl), storage: safeStorage() });
  // 调试入口（控制台 lolstonePlatform）：lolstonePlatform.current 是 SDK 的对局对象，能看 version、seats、connection。
  // window.lolstone 是对局控制，载入时会被换掉，所以单独放
  (window as unknown as { lolstonePlatform: unknown }).lolstonePlatform = link;
  return link;
}

async function openFakeLink(params: URLSearchParams): Promise<MatchLink> {
  const { FakeHub } = await import('../net/fakeLink');
  const autoplay = params.has('autoplay');
  const hub = new FakeHub({
    botDelayMs: 1000,
    connectMs: 600,
    autoBot: { level: 'L1', nickname: '练习机器人', joinMs: autoplay ? 300 : 1500 },
    storage: safeStorage(),
  });
  // 调试入口（控制台 lolstoneFake）：lolstoneFake.room(邀请码) 拿到房间，能模拟对手断线（setSeatConnected）、
  // 判负（forfeit）、计时到点（expire）
  (window as unknown as { lolstoneFake: unknown }).lolstoneFake = hub;
  return hub.link(fakePlayerId());
}

// 平台 SDK 的单文件脚本：插一个 <script>，载完从全局对象 Medeo 拿。已经载过（或者页面自己引了）就直接用；失败了下次再插
let sdkLoading: Promise<MedeoGlobal> | null = null;
function loadSdk(url: string): Promise<MedeoGlobal> {
  const found = (window as unknown as { Medeo?: MedeoGlobal }).Medeo;
  if (found) return Promise.resolve(found);
  sdkLoading ??= new Promise<MedeoGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      const sdk = (window as unknown as { Medeo?: MedeoGlobal }).Medeo;
      if (sdk) resolve(sdk);
      else reject(new Error('SDK script loaded but there is no global Medeo'));
    };
    script.onerror = () => reject(new Error(`SDK script ${url} failed to load`));
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    sdkLoading = null;
    throw err;
  });
  return sdkLoading;
}

export class OnlineClient {
  private match: RemoteMatch | null = null;
  private seats: SeatsBroadcast | null = null;
  // 在等一局开始（建房、进房、续局之后）。上一局离开后晚到的批次和广播不算新的一局
  private expecting = false;
  private autoplay = false;
  private games = 0;
  private nextGame: ReturnType<typeof setTimeout> | null = null;
  // 建房时带的 bot 座位（地址带 ?bot 时有）
  bots: BotConfig[] | null = null;
  // 自己建的、还在等人的房间的 key（自动驾驶合并房间用）
  private roomKey: string | null = null;

  constructor(
    private readonly shell: AppShell,
    private readonly link: MatchLink,
  ) {
    link.on('batch', (b) => this.onFirstBatch(b));
    link.on('seats', (s) => this.onSeats(s));
    link.on('ended', (e) => this.onEnded(e));
  }

  // 主菜单打开时问平台有没有没打完的局（online.md 3.3 续局）。昵称从本地存的来；没存过、又有没打完的局时问一下平台
  // （真平台的 SDK 脚本只在用到时加载：没有没打完的局就不动它，等联机面板打开再载）
  async init(): Promise<void> {
    try {
      const current = await this.link.currentMatch();
      let nickname = loadNickname();
      if (!nickname && current) nickname = (await this.link.identity()).nickname ?? '';
      this.roomKey = current && !current.started ? current.key : null;
      patchOnline({ nickname, pending: current ? { started: current.started, code: current.code } : null });
    } catch (err) {
      console.warn('[online] 连不上平台', err);
    }
  }

  // 联机面板打开时调：把平台的 SDK 载好、要到身份，建房时就不用等；没存过昵称时用平台记的
  warm(): void {
    void this.link
      .identity()
      .then((me) => {
        if (!getUi().online?.nickname && me.nickname) patchOnline({ nickname: me.nickname });
      })
      .catch((err: unknown) => console.warn('[online] 连不上平台', err));
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

  // 建房：职业和卡组用主菜单选的（预组或自组），先用 validateDeck 查一遍。isPublic 的房间在平台的公开列表里（自动驾驶用）
  async create(isPublic = false): Promise<void> {
    const seat = this.seatConfig();
    if (!seat) return;
    this.roomKey = null;
    this.enterWaiting(null);
    try {
      const created = await this.link.createMatch({ nickname: this.nickname(), seat, ...(this.bots ? { bots: this.bots } : {}), ...(isPublic ? { public: true } : {}) });
      if (this.cancelledMeanwhile()) return;
      this.roomKey = created.key;
      if (getUi().screen === 'waiting' && !this.match) patchOnline({ room: { code: created.code, joined: false } });
      if (isPublic) void this.autoplayMerge();
    } catch (err) {
      if (await this.recoverPending(err)) return;
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
    this.roomKey = null;
    this.enterWaiting(c);
    try {
      await this.link.joinMatch(c, { nickname: this.nickname(), seat });
      this.cancelledMeanwhile();
    } catch (err) {
      if (await this.recoverPending(err)) return;
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
      if (!pending.started && this.autoplay) void this.autoplayMerge();
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
    void this.finish();
  }

  // 结算面板：再来一局就是再建一个房间，回主菜单就是离开
  again(): void {
    void this.finish().then(() => this.create());
  }

  toMenu(): void {
    void this.finish();
  }

  // 自动驾驶（地址带 ?autoplay，在真平台或假平台上）：有没打完的局就续上，没有就找房或建房；一局结束后自动开下一局
  startAutoplay(): void {
    this.autoplay = true;
    if (!getUi().online?.nickname) this.setNickname('自动驾驶');
    subscribeUi(() => {
      const ui = getUi();
      if (!this.autoplay || !ui.result || this.nextGame || !this.match) return;
      const side = this.match.side;
      this.games++;
      console.info(`[online] 第 ${this.games} 局结束：${ui.result.won ? '胜' : ui.result.winner === 'draw' ? '平' : '负'}（${ui.result.reason}），${ui.result.turns} 回合`);
      this.nextGame = setTimeout(() => {
        this.nextGame = null;
        void this.finish().then(() => this.autoplayNext(side));
      }, AUTOPLAY_NEXT_MS);
    });
    if (getUi().online?.pending) void this.resumePending();
    else void this.autoplayNext(null);
  }

  // 自动驾驶的下一局。真平台上两个标签页要进同一个房间：建的房是公开的，另一个标签页从公开列表里找到它进去。
  // 第一局谁先打开谁建房，后打开的进它的房；之后上一局的 0 号位建房、1 号位等它建好再进。假平台没有公开列表，建房后 bot 自己坐进来
  private async autoplayNext(prevSide: Side | null): Promise<void> {
    if (this.link.listOpen && prevSide !== 0 && !this.bots) {
      const polls = prevSide === 1 ? AUTOPLAY_POLLS : 1;
      for (let i = 0; i < polls; i++) {
        const open = await this.link.listOpen().catch(() => []);
        if (open.length > 0) {
          void this.join(open[0]!.code);
          return;
        }
        if (i + 1 < polls) await sleep(AUTOPLAY_POLL_MS);
      }
    }
    void this.create(!this.bots);
  }

  // 自动驾驶的两个标签页同时打开时各自建了房，谁也等不到对手：在等待页上每隔几秒看一次公开列表，自己的房还空着、
  // 又不是最早建的那个，就放掉自己的、进最早的那个。两边看的是同一个列表，所以只有晚建的那一方会动
  private async autoplayMerge(): Promise<void> {
    while (this.autoplay && this.link.listOpen && !this.bots) {
      await sleep(AUTOPLAY_POLL_MS * 3);
      const mine = this.roomKey;
      if (!mine || this.match || getUi().screen !== 'waiting') return;
      const open = await this.link.listOpen().catch(() => []);
      if (!open.some((o) => o.key === mine)) return;
      const earliest = open[0]!;
      if (earliest.key === mine) continue;
      await this.cancel();
      void this.join(earliest.code);
      return;
    }
  }

  // 离开这一局（已经结束，或者刚认输）：断开对局、回主菜单。回主菜单之后才算完（接着建房的话等待页不能被它盖掉）
  private async finish(): Promise<void> {
    this.match?.stop();
    this.match = null;
    this.seats = null;
    this.roomKey = null;
    this.expecting = false;
    void this.link.leave().catch(() => {});
    patchOnline({ match: null, room: null, busy: false });
    await this.shell.load().then((game) => game.backToMenu());
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

  // 建房、进房被拒 already_in_match（这个主体还占着一局的座位，online.md 5.4）：问平台是哪一局，提示续上还是离开，
  // 离开了才能再建。问不到（比如是别的页面开的局、这里没记）就只提示
  private async recoverPending(err: unknown): Promise<boolean> {
    if (!(err instanceof LinkError) || err.code !== 'already_in_match') return false;
    const current = await this.link.currentMatch().catch(() => null);
    if (!current) return false;
    this.backToMenu(null);
    patchOnline({ pending: { started: current.started, code: current.code } });
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
    this.roomKey = null;
    patchOnline({ room: null, busy: false, notice, open: notice !== null });
    if (getUi().screen === 'waiting') setUi({ screen: 'menu' });
  }

  private onSeats(s: SeatsBroadcast): void {
    if (!this.expecting) return;
    this.seats = s;
    const room = getUi().online?.room;
    if (room && s.seats.length >= 2 && s.seats.every((x) => x.kind === 'bot' || x.player !== null)) patchOnline({ room: { ...room, joined: true } });
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

  // 对局没开起来就结束了（建房的人走了、setup 拒了）：回主菜单说明原因。开局后的结束由结算面板处理；
  // 正常打完的局顺手把平台导出的整局记录拿下来（online.md 第 7 节，回放的下载是 M6c 的事，先放在控制台能看到的地方）
  private onEnded(e: EndedBroadcast): void {
    if (this.match) {
      if (e.reason === 'result' && this.link.record) void this.fetchRecord();
      return;
    }
    if (!this.expecting) return;
    if (e.reason === 'setup_rejected') {
      const text = e.detail === 'version_mismatch' ? '游戏版本和对手不一致，刷新页面后再试' : `开局失败：${e.detail ?? e.reason}`;
      this.backToMenu(text);
    } else if (getUi().screen === 'waiting') this.backToMenu('房间已关闭');
  }

  private async fetchRecord(): Promise<void> {
    const record = await this.link.record!().catch(() => null);
    if (!record) return;
    (window as unknown as { lolstoneRecord: unknown }).lolstoneRecord = record;
    console.info(`[online] match record: seed ${record.seed}, ${record.actions.length} steps (window.lolstoneRecord)`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
