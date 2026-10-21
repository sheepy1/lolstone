// RemoteMatch（docs/online.md 3.3）接假平台跑：在途锁、批次交给导演、stale 被拒后解锁、换牌撞车后自动重发、
// 刷新页面后从当前快照建场景、认输和对手被判负时结果的原因、对手断线的宽限。导演是假的，只记下交给它的事件。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteMatch } from '../src/app/remoteMatch';
import { PRESET_DECKS } from '../src/cards';
import { poolHash } from '../src/cards/poolHash';
import type { HeroClass } from '../src/engine';
import { FakeHub, type FakeLink } from '../src/net/fakeLink';
import type { BotConfig, LinkBatch, MatchLink, SeatConfig, SeatsBroadcast } from '../src/net/link';
import type { Director } from '../src/presentation/director';
import type { PresentationEvent } from '../src/presentation/events';
import { viewFromState } from '../src/presentation/viewState';

const seat = (heroClass: HeroClass): SeatConfig => ({ heroClass, deck: [...PRESET_DECKS[heroClass]!], poolHash: poolHash() });

async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

type FakeDirector = Director & { batches: PresentationEvent[][]; busy: boolean };

function fakeDirector(): FakeDirector {
  const batches: PresentationEvent[][] = [];
  return { busy: false, batches, enqueue: (e: PresentationEvent[]) => batches.push([...e]) } as unknown as FakeDirector;
}

// 收到第一条批次时就建 RemoteMatch（和联机界面的做法一样），之后的批次由它自己订阅，一条不漏
function openMatch(link: MatchLink): Promise<RemoteMatch> {
  return new Promise((resolve) => {
    let seats: SeatsBroadcast | null = null;
    const offSeats = link.on('seats', (s) => (seats = s));
    const off = link.on('batch', (b) => {
      off();
      offSeats();
      resolve(new RemoteMatch(link, b, seats));
    });
  });
}

async function vsBot(bot: BotConfig = { level: 'L1', heroClass: 'noxus' }) {
  const hub = new FakeHub({ botDelayMs: 0, timers: false, seed: () => 42 });
  const link = hub.link('alice');
  const opened = openMatch(link);
  await link.createMatch({ nickname: '甲', seat: seat('demacia'), bots: [bot] });
  const match = await opened;
  const director = fakeDirector();
  match.start(director);
  await settle();
  return { hub, link, match, director, room: hub.roomOf('alice')! };
}

// 两个真人开一局：甲建房、乙进房，各自在收到开局批次时建 RemoteMatch。wrapB 可以把乙的连接包一层（扣住批次用）
async function humans(wrapB: (link: FakeLink) => MatchLink = (l) => l) {
  const hub = new FakeHub({ botDelayMs: 0, timers: false, seed: () => 7, now: () => 5000 });
  const la = hub.link('alice');
  const lb = hub.link('bob');
  const wrapped = wrapB(lb);
  const openedA = openMatch(la);
  const openedB = openMatch(wrapped);
  const { code } = await la.createMatch({ nickname: '甲', seat: seat('demacia') });
  await lb.joinMatch(code, { nickname: '乙', seat: seat('freljord') });
  const [a, b] = await Promise.all([openedA, openedB]);
  a.start(fakeDirector());
  b.start(fakeDirector());
  await settle();
  return { hub, la, lb, a, b, code };
}

// 包一层连接：hold 为 true 时收到的批次先扣着，flush 再按顺序放给订阅者（模拟被拒的回包比批次先到）。别的消息直通
function holdBatches(link: FakeLink): MatchLink & { hold: boolean; flush(): void } {
  const handlers = new Set<(b: LinkBatch) => void>();
  const held: LinkBatch[] = [];
  const emit = (b: LinkBatch) => [...handlers].forEach((h) => h(b));
  const wrapped: MatchLink & { hold: boolean; flush(): void } = {
    hold: false,
    flush() {
      this.hold = false;
      while (held.length) emit(held.shift()!);
    },
    identity: () => link.identity(),
    currentMatch: () => link.currentMatch(),
    createMatch: (req) => link.createMatch(req),
    joinMatch: (code, req) => link.joinMatch(code, req),
    leave: () => link.leave(),
    submit: (action) => link.submit(action),
    resume: (since) => link.resume(since),
    send: (type, data, to) => link.send(type, data, to),
    on: (type, handler) => {
      if (type !== 'batch') return link.on(type, handler);
      const h = handler as (b: LinkBatch) => void;
      handlers.add(h);
      return () => handlers.delete(h);
    },
  };
  link.on('batch', (b) => (wrapped.hold ? held.push(b) : emit(b)));
  return wrapped;
}

const mulliganOf = (m: RemoteMatch) => m.legalActions()!.find((a) => a.kind === 'mulligan')!;

afterEach(() => vi.restoreAllMocks());

describe('RemoteMatch', () => {
  it('开局那批在 start 时交给导演；之后每批到了都交给导演，visible、version 跟着平台走', async () => {
    const { match, director, room } = await vsBot();
    expect(match.side).toBe(0);
    expect(director.batches[0]!.map((e) => e.kind)).toContain('mulligan_start');
    // 开局的显示局面手牌是空的，起手由 mulligan_start 发
    expect(match.initial.players[0].hand).toEqual([]);
    expect(match.version).toBe(room.version);
    expect(match.visible).toEqual(room.table!.snapshotFor(0).game);
    expect(match.opponent).toMatchObject({ kind: 'bot', connected: true });
    // bot 已经换完牌：它那一步的批次对我遮完事件是空的，照样更新了 version
    expect(match.visible.players[1].mulliganDone).toBe(true);
  });

  it('在途锁：发出一个动作后、回包之前 legalActions 为 null；批次到了解锁', async () => {
    const { match } = await vsBot();
    const legal = match.legalActions()!;
    expect(legal.length).toBeGreaterThan(0);
    expect(match.submit(legal.find((a) => a.kind === 'mulligan')!)).toBeNull();
    expect(match.waiting).toBe(true);
    expect(match.legalActions()).toBeNull();
    expect(match.submit(legal[0]!)).toBe('input locked');
    await settle();
    expect(match.waiting).toBe(false);
    expect(match.visible.players[0].mulliganDone).toBe(true);
  });

  it('导演在播、不轮到我时也锁定；不合法的动作在快照上就被挡下，不发出去', async () => {
    const { match, director, link } = await vsBot();
    const spy = vi.spyOn(link, 'submit');
    director.busy = true;
    expect(match.legalActions()).toBeNull();
    director.busy = false;
    expect(match.submit({ kind: 'mulligan', player: 0, replace: [9] })).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    match.submit(match.legalActions()!.find((a) => a.kind === 'mulligan')!);
    await settle();
    // 到了对局阶段，不轮到我时为 null
    if (match.visible.current !== 0) expect(match.legalActions()).toBeNull();
  });

  it('和计时到点撞车被拒 stale：解除在途、记警告，局面按平台的走', async () => {
    const { match, room } = await vsBot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = match.version;
    expect(match.submit({ kind: 'mulligan', player: 0, replace: [0] })).toBeNull();
    room.expire();
    expect(match.legalActions()).toBeNull();
    await settle();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain('stale');
    expect(match.waiting).toBe(false);
    // 替我交的换牌生效了（之后轮到 bot 的话它会接着走）
    expect(match.version).toBeGreaterThan(before);
    expect(match.visible.phase).not.toBe('mulligan');
  });

  it('换牌阶段双方同时提交：后到的被拒 stale，新批次到了自动重发一次，两边都换完牌，玩家不用再点', async () => {
    const { la, lb, a, b } = await humans();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const sentA = vi.spyOn(la, 'submit');
    const sentB = vi.spyOn(lb, 'submit');
    expect(a.submit(mulliganOf(a))).toBeNull();
    expect(b.submit(mulliganOf(b))).toBeNull();
    await settle();
    // 甲的先到执行了，乙的撞上 version 被拒；乙的 RemoteMatch 按新 version 重发了同一个动作，平台接受
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('stale');
    expect(sentA).toHaveBeenCalledTimes(1);
    expect(sentB).toHaveBeenCalledTimes(2);
    expect(sentB.mock.calls[1]![0]).toEqual(sentB.mock.calls[0]![0]);
    expect(a.visible.players[0].mulliganDone).toBe(true);
    expect(b.visible.players[1].mulliganDone).toBe(true);
    expect(b.visible.phase).toBe('playing');
    expect(a.waiting).toBe(false);
    expect(b.waiting).toBe(false);
  });

  it('换牌撞车的被拒比批次先到：等批次期间输入仍锁定、不重发；批次到了才重发，且只重发一次', async () => {
    let held!: ReturnType<typeof holdBatches>;
    const { lb, a, b } = await humans((l) => (held = holdBatches(l)));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const sentB = vi.spyOn(lb, 'submit');
    expect(a.submit(mulliganOf(a))).toBeNull();
    expect(b.submit(mulliganOf(b))).toBeNull();
    held.hold = true;
    await settle();
    // 乙已被拒，但乙的 RemoteMatch 还没收到甲那一步的批次：等着重发，界面上还是锁的
    expect(sentB).toHaveBeenCalledTimes(1);
    expect(b.version).toBe(0);
    expect(b.waiting).toBe(true);
    expect(b.legalActions()).toBeNull();
    expect(b.submit({ kind: 'mulligan', player: 1, replace: [] })).toBe('input locked');
    held.flush();
    await settle();
    expect(sentB).toHaveBeenCalledTimes(2);
    expect(b.visible.players[1].mulliganDone).toBe(true);
    expect(b.waiting).toBe(false);
  });

  it('对局阶段的 stale（和回合计时到点撞车）仍然只解除在途，不重发', async () => {
    const { match, link, room } = await vsBot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    match.submit(mulliganOf(match));
    await settle();
    // 等到轮到我（bot 先手的话它会出完牌结束回合）
    for (let i = 0; i < 20 && match.visible.current !== 0; i++) await settle();
    expect(match.visible.phase).toBe('playing');
    expect(match.visible.current).toBe(0);
    const sent = vi.spyOn(link, 'submit');
    const before = match.version;
    expect(match.submit(match.legalActions()!.find((a) => a.kind === 'end_turn')!)).toBeNull();
    room.expire();
    await settle();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain('stale');
    expect(sent).toHaveBeenCalledTimes(1);
    expect(match.waiting).toBe(false);
    expect(match.version).toBeGreaterThan(before);
  });

  it('换个连接 resume(null)（页面刷新）：拿到当前快照，用 viewFromState 建场景，导演不回放历史', async () => {
    const { hub, match, room } = await vsBot();
    match.submit(match.legalActions()!.find((a) => a.kind === 'mulligan')!);
    await settle();
    match.stop();
    const link2 = hub.link('alice');
    const opened = openMatch(link2);
    await link2.resume(null);
    const again = await opened;
    const director = fakeDirector();
    again.start(director);
    await settle();
    const snap = room.table!.snapshotFor(0);
    expect(again.visible).toEqual(snap.game);
    expect(again.version).toBe(room.version);
    expect(again.initial).toEqual(viewFromState(snap.game, 0));
    expect(again.initial.players[0].hand.length).toBeGreaterThan(0);
    expect(director.batches).toEqual([]);
    expect(again.opponent?.kind).toBe('bot');
  });

  it('认输：发认输动作，等带 game_over 的批次，结果是对手获胜、原因 concede', async () => {
    const { match, director } = await vsBot();
    match.concede();
    await settle();
    expect(match.over).toBe(true);
    expect(director.batches.at(-1)!.map((e) => e.kind)).toEqual(['game_over']);
    expect(match.result).toEqual({ winner: 1, reason: 'concede' });
    expect(match.ended).toMatchObject({ reason: 'result', result: { winner: 1, reason: 'concede' } });
    expect(match.legalActions()).toBeNull();
  });

  it('对手断线：座位广播给出判负倒计时；宽限到了被判负，结果原因 abandon', async () => {
    const hub = new FakeHub({ botDelayMs: 0, timers: false, seed: () => 7, now: () => 5000 });
    const la = hub.link('alice');
    const lb = hub.link('bob');
    const opened = openMatch(la);
    const { code } = await la.createMatch({ nickname: '甲', seat: seat('demacia') });
    await lb.joinMatch(code, { nickname: '乙', seat: seat('freljord') });
    const match = await opened;
    match.start(fakeDirector());
    const changed = vi.fn();
    match.onChange = changed;
    await settle();
    expect(match.opponent).toMatchObject({ nickname: '乙', kind: 'human', connected: true, graceUntil: null });
    lb.disconnect();
    await settle();
    expect(changed).toHaveBeenCalled();
    expect(match.opponent?.connected).toBe(false);
    expect(match.opponent!.graceUntil! - Date.now()).toBeGreaterThan(50_000);
    hub.room(code)!.forfeit(1, 'abandon');
    await settle();
    expect(match.result).toEqual({ winner: 0, reason: 'abandon' });
    expect(match.opponent?.out).toBe(true);
  });

  it('对手断线中平台的广播没带宽限（runner 重启后恢复）：沿用之前的到期时刻；对手重连就清掉', async () => {
    const { la, lb, a } = await humans();
    lb.disconnect();
    await settle();
    // 到期时刻按 RemoteMatch 自己的时钟（Date.now）算，假平台给的 graceIn 是 60 秒
    const graceUntil = a.opponent!.graceUntil!;
    expect(graceUntil - Date.now()).toBeGreaterThan(55_000);
    const seatsMsg = (connected: boolean, graceIn: number | null): SeatsBroadcast => ({
      version: a.version,
      started: true,
      seats: [
        { seat: 0, kind: 'human', player: 'alice', nickname: '甲', connected: true, graceIn: null, out: false },
        { seat: 1, kind: 'human', player: 'bob', nickname: '乙', connected, graceIn, out: false },
      ],
    });
    la.emit('seats', seatsMsg(false, null));
    expect(a.opponent).toMatchObject({ connected: false, graceUntil, out: false });
    la.emit('seats', seatsMsg(true, null));
    expect(a.opponent).toMatchObject({ connected: true, graceUntil: null });
    // 之前在线、第一条断线广播就没带宽限：没有到期时刻可用，是 null（界面直接显示正在判定）
    la.emit('seats', seatsMsg(false, null));
    expect(a.opponent).toMatchObject({ connected: false, graceUntil: null });
  });
});
