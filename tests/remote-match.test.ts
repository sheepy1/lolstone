// RemoteMatch（docs/online.md 3.3）接假平台跑：在途锁、批次交给导演、stale 被拒后解锁、刷新页面后从当前快照建场景、
// 认输和对手被判负时结果的原因。导演是假的，只记下交给它的事件。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteMatch } from '../src/app/remoteMatch';
import { PRESET_DECKS } from '../src/cards';
import { poolHash } from '../src/cards/poolHash';
import type { HeroClass } from '../src/engine';
import { FakeHub, type FakeLink } from '../src/net/fakeLink';
import type { BotConfig, SeatConfig, SeatsBroadcast } from '../src/net/link';
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
function openMatch(link: FakeLink): Promise<RemoteMatch> {
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
});
