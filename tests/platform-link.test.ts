// 真平台的 MatchLink 实现（src/net/platformLink.ts）对平台 SDK 的翻译：用一个假的全局 Medeo 对象，断言建局、进局的参数，
// 批次、座位广播、结束广播、关局的映射，submit 的返回和拒绝码，already_in_match，按 storage 里的 key 续局，整局记录。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../src/engine';
import type { Snapshot } from '../src/logic/state';
import type { EndedBroadcast, KeyValueStorage, LinkBatch, Rejection, SeatsBroadcast } from '../src/net/link';
import { LinkError } from '../src/net/link';
import { CURRENT_MATCH_KEY, PlatformLink } from '../src/net/platformLink';
import type * as Sdk from '../src/net/sdkTypes';

type Handler = (...args: unknown[]) => void;

function medeoError(code: Sdk.MedeoErrorCode, message = code): Sdk.MedeoError {
  const err = new Error(message) as Error & { code: Sdk.MedeoErrorCode; name: 'MedeoError' };
  err.name = 'MedeoError';
  err.code = code;
  return err as unknown as Sdk.MedeoError;
}

// 假的 SDK 对局对象：记下调用，事件由测试手动触发
class FakeMatch implements Sdk.LogicMatch<Snapshot, GameEvent> {
  readonly authority = 'logic' as const;
  readonly capacity = 2;
  readonly meta = null;
  readonly me = { id: 'v_me', name: '' };
  seat: number | null = null;
  version: number | null = null;
  snapshot: Snapshot | undefined = undefined;
  latest: Sdk.LogicBatch<Snapshot, GameEvent> | null = null;
  deadline: number | null = null;
  seats: Sdk.LogicSeats | null = null;
  result: Sdk.LogicEnded | null = null;
  busy = false;
  connection: Sdk.ConnectionStatus = 'online';
  ended = false;
  submits: unknown[] = [];
  submitResult: Sdk.SubmitResult = { ok: true, version: 1 };
  recordResult: () => Promise<Sdk.MatchRecord> = () => Promise.reject(medeoError('match_not_found'));
  sent: { type: string; data: unknown; options: { to?: string } | undefined }[] = [];
  left = 0;
  resumed = 0;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(
    readonly key: string,
    readonly code: string,
  ) {}

  on<K extends keyof Sdk.LogicMatchEvents<Snapshot, GameEvent>>(name: K, fn: (...args: Sdk.LogicMatchEvents<Snapshot, GameEvent>[K]) => void): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn as Handler);
    return () => set.delete(fn as Handler);
  }

  emit<K extends keyof Sdk.LogicMatchEvents<Snapshot, GameEvent>>(name: K, ...args: Sdk.LogicMatchEvents<Snapshot, GameEvent>[K]): void {
    for (const h of [...(this.handlers.get(name) ?? [])]) h(...args);
  }

  listeners(name: string): number {
    return this.handlers.get(name)?.size ?? 0;
  }

  submit(action: unknown): Promise<Sdk.SubmitResult> {
    if (this.busy) throw medeoError('busy');
    this.submits.push(action);
    return Promise.resolve(this.submitResult);
  }

  send(type: string, data?: unknown, options?: { to?: string }): void {
    this.sent.push({ type, data, options });
  }

  resume(): Promise<Sdk.LogicBatch<Snapshot, GameEvent> | null> {
    this.resumed++;
    return Promise.resolve(null);
  }

  record(): Promise<Sdk.MatchRecord> {
    return this.recordResult();
  }

  leave(): Promise<void> {
    this.left++;
    this.ended = true;
    return Promise.resolve();
  }
}

// 假的平台：记下建局、进局的请求，按设定成功或失败
class FakeHub {
  creates: { options: Sdk.LogicCreateOptions; nickname: string | undefined }[] = [];
  joins: { key: string; options: Sdk.LogicJoinOptions; nickname: string | undefined }[] = [];
  lookups: string[] = [];
  fail: Sdk.MedeoErrorCode | null = null;
  open: Sdk.MatchSummary[] = [];
  matches: FakeMatch[] = [];
  viewers = 0;
  inits: (Sdk.MedeoOptions | undefined)[] = [];
  // 本地 runner 的 /_medeo/me 回的是没拍平的形状
  nestedViewer = false;
  private n = 0;

  newMatch(): FakeMatch {
    const m = new FakeMatch(`k${++this.n}`, `CODE${this.n}`);
    this.matches.push(m);
    return m;
  }

  get last(): FakeMatch {
    return this.matches[this.matches.length - 1]!;
  }

  global(): Sdk.MedeoGlobal {
    const hub = this;
    const medeo: Sdk.Medeo = {
      local: true,
      viewer: () => {
        hub.viewers++;
        const viewer = { kind: 'anonymous' as const, subject: 'v_me', scopes: [], profile: null, previous_subject: null };
        const app = { appKey: 'local', capabilities: { realtime: false, games: true, viewer_sign_in: false } };
        return Promise.resolve((hub.nestedViewer ? { viewer, app } : { ...viewer, app }) as Sdk.Viewer);
      },
    };
    const games = (_m: Sdk.Medeo, options: Sdk.GamesOptions = {}): Sdk.Games => ({
      listMatches: () => Promise.resolve(hub.open),
      createMatch: (<L extends Sdk.AnyLogic | undefined = undefined>(o: Sdk.LogicCreateOptions) => {
        hub.creates.push({ options: o, nickname: options.nickname });
        if (hub.fail) return Promise.reject(medeoError(hub.fail));
        return Promise.resolve(hub.newMatch() as unknown as Sdk.LogicMatchOf<L>);
      }) as Sdk.Games['createMatch'],
      joinMatch: (<L extends Sdk.AnyLogic | undefined = undefined>(key: string, o: Sdk.LogicJoinOptions) => {
        hub.joins.push({ key, options: o, nickname: options.nickname });
        if (hub.fail) return Promise.reject(medeoError(hub.fail));
        const existing = hub.matches.find((m) => m.key === key && !m.ended);
        return Promise.resolve((existing ?? hub.newMatch()) as unknown as Sdk.LogicMatchOf<L>);
      }) as Sdk.Games['joinMatch'],
      joinByCode: (<L extends Sdk.AnyLogic | undefined = undefined>(code: string, o: Sdk.LogicJoinOptions) => {
        hub.lookups.push(code);
        hub.joins.push({ key: `by:${code}`, options: o, nickname: options.nickname });
        if (hub.fail) return Promise.reject(medeoError(hub.fail));
        return Promise.resolve(hub.newMatch() as unknown as Sdk.LogicMatchOf<L>);
      }) as Sdk.Games['joinByCode'],
    });
    return {
      init: (options?: Sdk.MedeoOptions) => {
        hub.inits.push(options);
        return medeo;
      },
      games,
      MedeoError: Error as unknown as Sdk.MedeoGlobal['MedeoError'],
    };
  }
}

// 等假平台把对局对象建出来（SDK 加载、init、games、建局或进局是一串异步）
async function untilMatch(count = 1): Promise<FakeMatch> {
  for (let i = 0; i < 100 && hub.matches.length < count; i++) await new Promise((r) => setTimeout(r, 0));
  if (hub.matches.length < count) throw new Error('对局对象没建出来');
  return hub.last;
}

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

// storage 里记的当前对局：按主体分开，值是 JSON
function storedKey(subject = 'v_me'): string | undefined {
  return (JSON.parse(storage.map.get(CURRENT_MATCH_KEY) ?? '{}') as Record<string, string>)[subject];
}

function storeKey(key: string, subject = 'v_me'): void {
  storage.setItem(CURRENT_MATCH_KEY, JSON.stringify({ ...JSON.parse(storage.map.get(CURRENT_MATCH_KEY) ?? '{}'), [subject]: key }));
}

const snapshot = { game: { phase: 'mulligan' }, reason: null } as unknown as Snapshot;
const seatConfig = { heroClass: 'demacia' as const, deck: ['a'], poolHash: 'h' };

function batch(over: Partial<Sdk.LogicBatch<Snapshot, GameEvent>> = {}): Sdk.LogicBatch<Snapshot, GameEvent> {
  return { version: 0, seat: 0, cause: 'setup', events: [], snapshot, deadlineIn: 60_000, mine: false, ...over };
}

function seats(over: Partial<Sdk.LogicSeats> = {}): Sdk.LogicSeats {
  return {
    version: 0,
    started: true,
    seats: [
      { seat: 0, kind: 'human', player: 'v_me', nickname: '甲', connected: true, graceIn: null, out: false },
      { seat: 1, kind: 'human', player: 'v_them', nickname: '乙', connected: false, graceIn: 41_000, out: false },
    ],
    ...over,
  };
}

let hub: FakeHub;
let storage: ReturnType<typeof memoryStorage>;
let link: PlatformLink;
let sdkLoads: number;

beforeEach(() => {
  hub = new FakeHub();
  storage = memoryStorage();
  sdkLoads = 0;
  link = new PlatformLink({
    sdk: () => {
      sdkLoads++;
      return Promise.resolve(hub.global());
    },
    storage,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('建房、进房', () => {
  it('createMatch：authority 是 logic，座位 config、bots、昵称都交给 SDK；返回邀请码和 0 号位；key 记进 storage；SDK 只加载一次', async () => {
    const created = await link.createMatch({ nickname: '甲', seat: seatConfig, bots: [{ level: 'L1', heroClass: 'noxus' }] });
    expect(created).toEqual({ key: 'k1', code: 'CODE1', seat: 0 });
    expect(hub.creates).toHaveLength(1);
    expect(hub.creates[0]!.nickname).toBe('甲');
    expect(hub.creates[0]!.options).toEqual({ authority: 'logic', seat: seatConfig, bots: [{ level: 'L1', heroClass: 'noxus' }] });
    expect(storedKey()).toBe('k1');
    await link.identity();
    expect(sdkLoads).toBe(1);
    // 不用 SDK 的本机模式：身份和公开列表都要平台的
    expect(hub.inits).toEqual([{ local: false }]);
  });

  it('公开的房间才带 visibility；不带 bots 时不传空数组', async () => {
    await link.createMatch({ nickname: '甲', seat: seatConfig, public: true });
    expect(hub.creates[0]!.options).toEqual({ authority: 'logic', seat: seatConfig, visibility: 'public' });
  });

  it('joinMatch：邀请码去空格、转大写，座位广播到了按主体 id 认出自己的座位', async () => {
    const joining = link.joinMatch(' code2 ', { nickname: '乙', seat: seatConfig });
    const m = await untilMatch();
    m.emit('seats', seats({ started: false, seats: [{ seat: 0, kind: 'human', player: 'v_them', nickname: '甲', connected: true, graceIn: null, out: false }, { seat: 1, kind: 'human', player: 'v_me', nickname: '乙', connected: true, graceIn: null, out: false }] }));
    expect(await joining).toEqual({ key: 'k1', seat: 1 });
    expect(hub.lookups).toEqual(['CODE2']);
    expect(hub.joins[0]!.options).toEqual({ authority: 'logic', seat: seatConfig });
    expect(hub.joins[0]!.nickname).toBe('乙');
  });

  it('平台的错误码翻译成接口的：match_not_found、match_closed 是 no_such_match，match_started 是 match_full，already_in_match 原样', async () => {
    for (const [sdk, ours] of [
      ['match_not_found', 'no_such_match'],
      ['match_closed', 'no_such_match'],
      ['match_started', 'match_full'],
      ['match_full', 'match_full'],
      ['already_in_match', 'already_in_match'],
      ['unavailable', 'unavailable'],
    ] as const) {
      hub.fail = sdk;
      const err = await link.joinMatch('X', { nickname: '乙', seat: seatConfig }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LinkError);
      expect((err as LinkError).code).toBe(ours);
    }
  });

  it('身份：云端平铺的和本地 runner 没拍平的回答都认得出主体', async () => {
    expect(await link.identity()).toEqual({ player: 'v_me', nickname: null });
    hub.nestedViewer = true;
    expect(await link.identity()).toEqual({ player: 'v_me', nickname: null });
  });

  it('SDK 加载失败：抛 unavailable，下一次再试着加载', async () => {
    let fail = true;
    const l = new PlatformLink({
      sdk: () => (fail ? Promise.reject(new Error('404')) : Promise.resolve(hub.global())),
      storage,
    });
    await expect(l.identity()).rejects.toMatchObject({ code: 'unavailable' });
    fail = false;
    expect(await l.identity()).toEqual({ player: 'v_me', nickname: null });
  });

  it('leave：SDK 的 leave 调一次，storage 里的 key 清掉，之后的消息不再转发', async () => {
    await link.createMatch({ nickname: '甲', seat: seatConfig });
    const m = hub.last;
    const got: LinkBatch[] = [];
    link.on('batch', (b) => got.push(b));
    await link.leave();
    expect(m.left).toBe(1);
    expect(storage.map.has(CURRENT_MATCH_KEY)).toBe(false);
    m.emit('batch', batch());
    expect(got).toEqual([]);
  });
});

describe('事件的映射', () => {
  let m: FakeMatch;
  let batches: LinkBatch[];
  let seatsSeen: SeatsBroadcast[];
  let endeds: EndedBroadcast[];

  beforeEach(async () => {
    batches = [];
    seatsSeen = [];
    endeds = [];
    link.on('batch', (b) => batches.push(b));
    link.on('seats', (s) => seatsSeen.push(s));
    link.on('ended', (e) => endeds.push(e));
    await link.createMatch({ nickname: '甲', seat: seatConfig });
    m = hub.last;
  });

  it('批次：version、seat、cause、events、snapshot、deadlineIn 原样；自己的那一步带 requestId，别人的不带；tick 当作 action；没有快照的丢掉', async () => {
    m.emit('batch', batch());
    expect(batches[0]).toEqual({ version: 0, seat: 0, cause: 'setup', events: [], snapshot, deadlineIn: 60_000 });
    expect('requestId' in batches[0]!).toBe(false);
    await link.submit({ kind: 'end_turn' });
    m.emit('batch', batch({ version: 1, cause: 'action', mine: true, deadlineIn: null }));
    expect(batches[1]).toMatchObject({ version: 1, cause: 'action', deadlineIn: null, requestId: 'r1' });
    m.emit('batch', batch({ version: 2, cause: 'tick' }));
    expect(batches[2]!.cause).toBe('action');
    m.emit('batch', { ...batch({ version: 3 }), snapshot: undefined });
    expect(batches).toHaveLength(3);
  });

  it('座位广播：开局前 version 是 null 翻成 0；graceIn、out、昵称原样', () => {
    m.emit('seats', seats({ version: null, started: false }));
    expect(seatsSeen[0]).toEqual({
      version: 0,
      started: false,
      seats: [
        { seat: 0, kind: 'human', player: 'v_me', nickname: '甲', connected: true, graceIn: null, out: false },
        { seat: 1, kind: 'human', player: 'v_them', nickname: '乙', connected: false, graceIn: 41_000, out: false },
      ],
    });
  });

  it('结束广播：result 的形状对就带上，不对就 null；detail 原样；不认识的 reason 当 abandoned；之后 storage 里的 key 清掉', () => {
    m.emit('ended', { version: 12, reason: 'result', result: { winner: 1, reason: 'concede' } });
    expect(endeds[0]).toEqual({ version: 12, reason: 'result', result: { winner: 1, reason: 'concede' } });
    expect(storage.map.has(CURRENT_MATCH_KEY)).toBe(false);
    m.emit('ended', { version: null, reason: 'setup_rejected', result: null, detail: 'version_mismatch' });
    expect(endeds[1]).toEqual({ version: 0, reason: 'setup_rejected', result: null, detail: 'version_mismatch' });
    m.emit('ended', { version: 3, reason: 'result', result: { winner: 2, reason: 'game' } });
    expect(endeds[2]!.result).toBeNull();
    m.emit('ended', { version: 3, reason: 'something_new', result: null });
    expect(endeds[3]!.reason).toBe('abandoned');
  });

  it('关局：前面有结束广播的不再补；没有的（等人超时）补一条 abandoned，detail 是平台的原因', () => {
    m.emit('closed', { reason: 'never_joined' });
    expect(endeds).toEqual([{ version: 0, reason: 'abandoned', result: null, detail: 'never_joined' }]);
    expect(storage.map.has(CURRENT_MATCH_KEY)).toBe(false);
    m.emit('closed', { reason: 'idle' });
    expect(endeds).toHaveLength(1);
  });

  it('瞬时消息：收的原样转发，发的带收件人', () => {
    const got: unknown[] = [];
    link.on('message', (msg) => got.push(msg));
    m.emit('message', { type: 'holding', data: 3, from: 'v_them' });
    expect(got).toEqual([{ type: 'holding', data: 3, from: 'v_them' }]);
    link.send('holding', null, 'v_them');
    link.send('holding', 5);
    expect(m.sent).toEqual([
      { type: 'holding', data: null, options: { to: 'v_them' } },
      { type: 'holding', data: 5, options: {} },
    ]);
  });
});

describe('submit', () => {
  let m: FakeMatch;
  let rejections: Rejection[];

  beforeEach(async () => {
    rejections = [];
    link.on('rejected', (r) => rejections.push(r));
    await link.createMatch({ nickname: '甲', seat: seatConfig });
    m = hub.last;
  });

  it('执行了返回 null，动作原样交给 SDK', async () => {
    expect(await link.submit({ kind: 'end_turn' })).toBeNull();
    expect(m.submits).toEqual([{ kind: 'end_turn' }]);
    expect(rejections).toEqual([]);
  });

  it('被拒：拒绝码和原因原样，没给原因用码；SDK 自己的 timeout 翻成 unavailable；同时发 rejected 事件', async () => {
    m.submitResult = { ok: false, code: 'invalid', reason: 'not your turn', version: 4 };
    expect(await link.submit({ kind: 'end_turn' })).toEqual({ code: 'invalid', reason: 'not your turn' });
    expect(rejections[0]).toEqual({ code: 'invalid', reason: 'not your turn', requestId: 'r1', version: 4 });
    m.submitResult = { ok: false, code: 'stale', version: 5 };
    expect(await link.submit({ kind: 'end_turn' })).toEqual({ code: 'stale', reason: 'stale' });
    m.submitResult = { ok: false, code: 'timeout', version: null };
    expect(await link.submit({ kind: 'end_turn' })).toEqual({ code: 'unavailable', reason: 'timeout' });
    expect(rejections[2]!.version).toBe(0);
  });

  it('上一个动作还在途（SDK 的 busy）：等它回包再发，不抛', async () => {
    m.busy = true;
    const p = link.submit({ kind: 'concede' });
    await new Promise((r) => setTimeout(r, 120));
    expect(m.submits).toEqual([]);
    m.busy = false;
    expect(await p).toBeNull();
    expect(m.submits).toEqual([{ kind: 'concede' }]);
  });

  it('没有对局时拒 not_seated；对局已结束（SDK 退订）也是', async () => {
    await link.leave();
    expect(await link.submit({ kind: 'end_turn' })).toEqual({ code: 'not_seated', reason: 'not seated' });
  });
});

describe('续局：平台没有"我在哪一局"的接口，按 storage 里的 key 重新进局', () => {
  it('没记过 key：不加载 SDK，直接 null；记的是别的主体的（同一个浏览器派生的另一个玩家）也是 null', async () => {
    expect(await link.currentMatch()).toBeNull();
    expect(sdkLoads).toBe(0);
    storeKey('k7', 'v_other');
    expect(await link.currentMatch()).toBeNull();
    expect(hub.joins).toEqual([]);
    expect(storedKey('v_other')).toBe('k7');
  });

  it('记了 key：先问平台我是谁，按 key 进局（不带座位 config），座位广播到了给出座位、邀请码和 started；再问一次不再进局', async () => {
    storeKey('k9');
    const asking = link.currentMatch();
    const m = await untilMatch();
    expect(hub.joins).toEqual([{ key: 'k9', options: { authority: 'logic' }, nickname: undefined }]);
    m.emit('seats', seats({ started: false, version: null }));
    expect(await asking).toEqual({ key: 'k1', code: 'CODE1', seat: 0, started: false });
    m.seats = seats({ started: true });
    expect(await link.currentMatch()).toEqual({ key: 'k1', code: null, seat: 0, started: true });
    expect(hub.joins).toHaveLength(1);
  });

  it('房间已关（match_closed）或已结束：清掉 key，回 null；已经被判负（out）也算没有', async () => {
    storeKey('k9');
    hub.fail = 'match_closed';
    expect(await link.currentMatch()).toBeNull();
    expect(storage.map.has(CURRENT_MATCH_KEY)).toBe(false);
    hub.fail = null;
    storeKey('k8');
    const asking = link.currentMatch();
    (await untilMatch()).emit('seats', seats({ seats: [{ seat: 0, kind: 'human', player: 'v_me', nickname: '甲', connected: true, graceIn: null, out: true }] }));
    expect(await asking).toBeNull();
    expect(storage.map.has(CURRENT_MATCH_KEY)).toBe(false);
  });

  it('还占着一局（currentMatch 拿到的）时再建房、进房：本地就拒 already_in_match，不去问平台', async () => {
    storeKey('k9');
    const asking = link.currentMatch();
    (await untilMatch()).emit('seats', seats());
    await asking;
    await expect(link.createMatch({ nickname: '甲', seat: seatConfig })).rejects.toMatchObject({ code: 'already_in_match' });
    expect(hub.creates).toEqual([]);
    // 离开了就能建
    await link.leave();
    await link.createMatch({ nickname: '甲', seat: seatConfig });
    expect(hub.creates).toHaveLength(1);
  });

  it('resume：有对局对象就向 SDK 要当前快照；没有（刷新页面）就按记的 key 进局，SDK 订上通道时自己发恢复请求', async () => {
    storeKey('k9');
    await link.resume(null);
    expect(hub.joins.map((j) => j.key)).toEqual(['k9']);
    expect(hub.last.resumed).toBe(0);
    await link.resume(7);
    expect(hub.last.resumed).toBe(1);
    expect(hub.joins).toHaveLength(1);
    await link.leave();
    expect(storage.map.has(CURRENT_MATCH_KEY)).toBe(false);
    await expect(link.resume(null)).rejects.toMatchObject({ code: 'no_such_match' });
  });
});

describe('整局记录和公开列表', () => {
  it('record：平台的记录翻译成接口的形状（动作、计时到点、判负各一种），result 形状不对就 null', async () => {
    await link.createMatch({ nickname: '甲', seat: seatConfig });
    hub.last.recordResult = () =>
      Promise.resolve({
        seed: 42,
        options: null,
        seats: [
          { kind: 'human', config: seatConfig },
          { kind: 'bot', config: { level: 'L1', heroClass: 'noxus' } },
        ],
        actions: [
          { seat: 0, action: { kind: 'mulligan', player: 0, replace: [] }, at: '2026-10-20T12:00:00.000Z', source: 'action' },
          { seat: 1, action: { kind: 'end_turn' }, at: '2026-10-20T12:00:01.000Z', source: 'bot' },
          { seat: 0, action: null, at: '2026-10-20T12:01:00.000Z', source: 'timeout' },
          { seat: 1, action: null, at: '2026-10-20T12:02:00.000Z', source: 'forfeit', reason: 'abandon' },
        ],
        result: { winner: 0, reason: 'abandon' },
      });
    const record = await link.record();
    expect(record).toEqual({
      seed: 42,
      options: null,
      seats: [
        { kind: 'human', config: seatConfig },
        { kind: 'bot', config: { level: 'L1', heroClass: 'noxus' } },
      ],
      actions: [
        { seat: 0, action: { kind: 'mulligan', player: 0, replace: [] }, at: '2026-10-20T12:00:00.000Z', source: 'action' },
        { seat: 1, action: { kind: 'end_turn' }, at: '2026-10-20T12:00:01.000Z', source: 'bot' },
        { seat: 0, action: null, at: '2026-10-20T12:01:00.000Z', source: 'timeout' },
        { seat: 1, action: null, at: '2026-10-20T12:02:00.000Z', source: 'forfeit', reason: 'abandon' },
      ],
      result: { winner: 0, reason: 'abandon' },
    });
  });

  it('record：平台还没关局（match_not_ended）就隔一会儿再试；没声明导出（match_not_found）回 null，不记警告', async () => {
    vi.useFakeTimers();
    await link.createMatch({ nickname: '甲', seat: seatConfig });
    let calls = 0;
    hub.last.recordResult = () => (++calls < 3 ? Promise.reject(medeoError('match_not_ended')) : Promise.resolve({ seed: 1, options: null, seats: [], actions: [], result: null }));
    const asking = link.record();
    await vi.advanceTimersByTimeAsync(1100);
    expect(await asking).toEqual({ seed: 1, options: null, seats: [], actions: [], result: null });
    expect(calls).toBe(3);
    hub.last.recordResult = () => Promise.reject(medeoError('match_not_found'));
    expect(await link.record()).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('record：没有对局时 null；对局结束、离开之后还拿得到（结算面板之后再要也行）', async () => {
    expect(await link.record()).toBeNull();
    await link.createMatch({ nickname: '甲', seat: seatConfig });
    const m = hub.last;
    m.recordResult = () => Promise.resolve({ seed: 2, options: null, seats: [], actions: [], result: null });
    m.emit('ended', { version: 1, reason: 'result', result: { winner: 0, reason: 'game' } });
    m.emit('closed', { reason: 'closed' });
    expect((await link.record())?.seed).toBe(2);
  });

  it('listOpen：只列有人在等、还有空位的，按建房时间从早到晚', async () => {
    hub.open = [
      { key: 'a', code: 'AAAA', capacity: 2, visibility: 'public', protocol: 1, meta: null, players: 1, createdAt: '2026-10-20T12:00:02Z' },
      { key: 'b', code: 'BBBB', capacity: 2, visibility: 'public', protocol: 1, meta: null, players: 2, createdAt: '2026-10-20T12:00:00Z' },
      { key: 'c', code: 'CCCC', capacity: 2, visibility: 'public', protocol: 1, meta: null, players: 1, createdAt: '2026-10-20T12:00:01Z' },
      { key: 'd', code: 'DDDD', capacity: 2, visibility: 'public', protocol: 1, meta: null, players: 0, createdAt: '2026-10-20T11:00:00Z' },
    ];
    expect(await link.listOpen()).toEqual([
      { key: 'c', code: 'CCCC', createdAt: '2026-10-20T12:00:01Z' },
      { key: 'a', code: 'AAAA', createdAt: '2026-10-20T12:00:02Z' },
    ]);
  });
});
