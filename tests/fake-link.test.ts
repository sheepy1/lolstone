// 假平台（src/net/fakeLink.ts）按协议的行为（docs/online.md 4.3、4.4、5.3）：每步每座位一条批次、version 连续，
// stale 和 invalid 的拒绝，计时到点按座位依次调、带回新 deadline 就停，恢复时补批次或给当前快照，断线判负。
import { describe, expect, it } from 'vitest';
import { l0ChooseAction } from '../src/ai/l0';
import { PRESET_DECKS } from '../src/cards';
import { poolHash } from '../src/cards/poolHash';
import { listLegalActions, other, seedRng, type HeroClass, type Side } from '../src/engine';
import { FakeHub, type FakeLink } from '../src/net/fakeLink';
import type { EndedBroadcast, LinkBatch, SeatConfig, SeatsBroadcast } from '../src/net/link';

const seat = (heroClass: HeroClass): SeatConfig => ({ heroClass, deck: [...PRESET_DECKS[heroClass]!], poolHash: poolHash() });

// 让排着的微任务和 0 毫秒的定时器（bot 出手）都跑完
async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

type Inbox = { batches: LinkBatch[]; seats: SeatsBroadcast[]; ended: EndedBroadcast[] };

function record(link: FakeLink): Inbox {
  const inbox: Inbox = { batches: [], seats: [], ended: [] };
  link.on('batch', (b) => inbox.batches.push(b));
  link.on('seats', (s) => inbox.seats.push(s));
  link.on('ended', (e) => inbox.ended.push(e));
  return inbox;
}

function hub(): FakeHub {
  return new FakeHub({ botDelayMs: 0, timers: false, seed: () => 42, now: () => 1000 });
}

// 两个真人对局：各自只看自己收到的快照，用 L0 随机出合法动作，直到结束
async function playHumans(): Promise<{ a: Inbox; b: Inbox }> {
  const h = hub();
  const la = h.link('alice');
  const lb = h.link('bob');
  const a = record(la);
  const b = record(lb);
  const { code } = await la.createMatch({ nickname: '甲', seat: seat('demacia') });
  await lb.joinMatch(code, { nickname: '乙', seat: seat('noxus') });
  await settle();
  const links: [FakeLink, FakeLink] = [la, lb];
  const inboxes: [Inbox, Inbox] = [a, b];
  let rng = seedRng(7);
  for (let n = 0; n < 400 && a.ended.length === 0; n++) {
    let acted = false;
    for (const side of [0, 1] as const) {
      const last = inboxes[side].batches.at(-1)!;
      const g = last.snapshot.game;
      const mine = g.phase === 'mulligan' ? !g.players[side].mulliganDone : g.phase === 'playing' && g.current === side;
      if (!mine) continue;
      const choice = l0ChooseAction(g, side, rng)!;
      rng = choice.rng;
      expect(await links[side].submit(choice.action)).toBeNull();
      await settle(2);
      acted = true;
    }
    expect(acted).toBe(true);
  }
  await settle();
  return { a, b };
}

describe('批次：每一步每个座位一条，version 连续', () => {
  it('两个真人打完一局：双方收到的 version 都是 0、1、2……，条数一样，遮完没事件也发', async () => {
    const { a, b } = await playHumans();
    for (const inbox of [a, b]) {
      expect(inbox.batches.map((x) => x.version)).toEqual(inbox.batches.map((_, i) => i));
      expect(inbox.batches[0]!.cause).toBe('setup');
      expect(inbox.ended).toHaveLength(1);
      expect(inbox.ended[0]!.reason).toBe('result');
      expect(inbox.ended[0]!.result?.reason).toBe('game');
    }
    expect(a.batches.length).toBe(b.batches.length);
    // 对手的回合里我收到的批次照样一条不少，而且有遮完是空事件的（对手换牌只有一方提交时引擎不发事件）
    expect([...a.batches, ...b.batches].some((x) => x.events.length === 0)).toBe(true);
    // requestId 只在自己的动作那一步有
    a.batches.forEach((x, i) => {
      const y = b.batches[i]!;
      expect(x.cause).toBe(y.cause);
      if (x.requestId) expect(y.requestId).toBeUndefined();
    });
    // 开局的座位广播：两个人类座位，昵称都在，不带座位 config
    const started = a.seats.find((s) => s.started)!;
    expect(started.seats.map((s) => s.nickname)).toEqual(['甲', '乙']);
    expect(JSON.stringify(started)).not.toContain('deck');
  });

  it('对 bot：bot 的每一步也是每个座位一条，cause 为 bot', async () => {
    const h = hub();
    const link = h.link('alice');
    const inbox = record(link);
    await link.createMatch({ nickname: '甲', seat: seat('demacia'), bots: [{ level: 'L1', heroClass: 'freljord' }] });
    await settle();
    // 我方只换牌、结束回合，看 bot 一回合回合地打
    for (let n = 0; n < 200 && inbox.ended.length === 0; n++) {
      const g = inbox.batches.at(-1)!.snapshot.game;
      const mine = g.phase === 'mulligan' ? !g.players[0].mulliganDone : g.phase === 'playing' && g.current === 0;
      if (mine) {
        const legal = listLegalActions(g, 0);
        expect(await link.submit(legal.find((x) => x.kind === 'mulligan' || x.kind === 'end_turn')!)).toBeNull();
      }
      await settle(3);
    }
    expect(inbox.ended).toHaveLength(1);
    expect(inbox.ended[0]!.result).toEqual({ winner: 1, reason: 'game' });
    expect(inbox.batches.map((x) => x.version)).toEqual(inbox.batches.map((_, i) => i));
    expect(inbox.batches.filter((x) => x.cause === 'bot').length).toBeGreaterThan(5);
    expect(inbox.batches.every((x) => x.events.every((e) => (e.kind as string) !== 'ai_thinking'))).toBe(true);
    const seats = inbox.seats.at(-1)!;
    expect(seats.seats[1]).toMatchObject({ kind: 'bot', player: null });
  });
});

describe('拒绝', () => {
  async function started(): Promise<{ h: FakeHub; link: FakeLink; inbox: Inbox }> {
    const h = hub();
    const link = h.link('alice');
    const inbox = record(link);
    await link.createMatch({ nickname: '甲', seat: seat('demacia'), bots: [{ level: 'L0', heroClass: 'noxus' }] });
    await settle();
    return { h, link, inbox };
  }

  it('发出后、到平台前计时到点抢先一步：拒 stale，局面不按这个动作走', async () => {
    const { h, link, inbox } = await started();
    const before = inbox.batches.length;
    const pending = link.submit({ kind: 'mulligan', player: 0, replace: [0] });
    h.roomOf('alice')!.expire();
    expect(await pending).toEqual({ code: 'stale', reason: 'stale' });
    await settle();
    const timeouts = inbox.batches.slice(before).filter((b) => b.cause === 'timeout');
    expect(timeouts).toHaveLength(1);
    // 替我交的是"一张都不换"，不是我那个换一张的动作
    expect(timeouts[0]!.events.some((e) => e.kind === 'mulligan_done' && e.side === 0 && e.replaced.length === 0)).toBe(true);
  });

  it('apply 拒了的动作拒 invalid，原因原样；不合 JSON 的大小也拒', async () => {
    const { link, inbox } = await started();
    const g = inbox.batches.at(-1)!.snapshot.game;
    expect(g.phase).toBe('mulligan');
    expect(await link.submit({ kind: 'end_turn' })).toEqual({ code: 'invalid', reason: 'not your turn' });
    expect(await link.submit({ kind: 'mulligan', player: 0, replace: Array(3000).fill(0) })).toMatchObject({ code: 'too_large' });
    expect(inbox.batches.at(-1)!.version).toBe(inbox.batches.length - 1);
  });
});

describe('计时到点（online.md 4.1、5.3）', () => {
  it('换牌阶段双方都没交：按座位号依次替两边交，进入对局阶段那一步带回 75 秒就停', async () => {
    const h = hub();
    const la = h.link('alice');
    const lb = h.link('bob');
    const a = record(la);
    const { code } = await la.createMatch({ nickname: '甲', seat: seat('demacia') });
    await lb.joinMatch(code, { nickname: '乙', seat: seat('noxus') });
    await settle();
    const room = h.room(code)!;
    expect(room.table!.deadline).not.toBeNull();
    room.expire();
    await settle();
    const steps = a.batches.filter((b) => b.cause === 'timeout');
    expect(steps).toHaveLength(2);
    expect(steps[1]!.snapshot.game.phase).toBe('playing');
    expect(steps[1]!.deadlineIn).toBe(75_000);
  });

  it('对局阶段：替当前方结束回合、带回新的 75 秒，这一轮就停，不会接着替刚换上来的另一方也结束', async () => {
    const h = hub();
    const la = h.link('alice');
    const lb = h.link('bob');
    const a = record(la);
    const { code } = await la.createMatch({ nickname: '甲', seat: seat('demacia') });
    await lb.joinMatch(code, { nickname: '乙', seat: seat('noxus') });
    await settle();
    const room = h.room(code)!;
    room.expire();
    await settle();
    for (let i = 0; i < 4; i++) {
      const before = a.batches.length;
      const current = a.batches.at(-1)!.snapshot.game.current;
      room.expire();
      await settle();
      const steps = a.batches.slice(before);
      expect(steps).toHaveLength(1);
      expect(steps[0]!.cause).toBe('timeout');
      expect(steps[0]!.snapshot.game.current).toBe(other(current));
      expect(steps[0]!.deadlineIn).toBe(75_000);
    }
  });
});

describe('恢复（online.md 4.3 的重连）', () => {
  it('since 之后的批次还在就按顺序补发；since 为 null 给一条 cause 为 resume 的当前快照，再补座位广播', async () => {
    const h = hub();
    const link = h.link('alice');
    const inbox = record(link);
    await link.createMatch({ nickname: '甲', seat: seat('ionia'), bots: [{ level: 'L1', heroClass: 'noxus' }] });
    await settle();
    await link.submit({ kind: 'mulligan', player: 0, replace: [] });
    await settle();
    const all = inbox.batches.length;
    expect(all).toBeGreaterThan(2);

    const again = h.link('alice');
    const re = record(again);
    await again.resume(0);
    await settle();
    expect(re.batches.map((b) => b.version)).toEqual(inbox.batches.slice(1).map((b) => b.version));
    expect(re.batches).toEqual(inbox.batches.slice(1));

    const fresh = h.link('alice');
    const rf = record(fresh);
    await fresh.resume(null);
    await settle();
    expect(rf.batches).toHaveLength(1);
    const snap = rf.batches[0]!;
    expect(snap.cause).toBe('resume');
    expect(snap.events).toEqual([]);
    expect(snap.version).toBe(inbox.batches.at(-1)!.version);
    expect(snap.snapshot).toEqual(h.roomOf('alice')!.table!.snapshotFor(0));
    expect(rf.seats.at(-1)!.started).toBe(true);
  });

  it('存进 storage 的房间装回来（模拟刷新页面）：按动作日志重放出同一个局面，接着打', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const h = new FakeHub({ botDelayMs: 0, timers: false, seed: () => 99, storage });
    const link = h.link('alice');
    const inbox = record(link);
    await link.createMatch({ nickname: '甲', seat: seat('demacia'), bots: [{ level: 'L1', heroClass: 'freljord' }] });
    await settle();
    await link.submit({ kind: 'mulligan', player: 0, replace: [1] });
    await settle();
    for (let i = 0; i < 3; i++) {
      const g = inbox.batches.at(-1)!.snapshot.game;
      if (g.current === 0) await link.submit({ kind: 'end_turn' });
      await settle();
    }
    const room = h.roomOf('alice')!;
    const saved = room.table!.snapshotFor(0);

    const h2 = new FakeHub({ botDelayMs: 0, timers: false, storage });
    const room2 = h2.roomOf('alice')!;
    expect(room2.version).toBe(room.version);
    expect(room2.table!.snapshotFor(0)).toEqual(saved);
    expect(room2.table!.state).toEqual(room.table!.state);
    const link2 = h2.link('alice');
    const r2 = record(link2);
    expect(await link2.currentMatch()).toMatchObject({ seat: 0, started: true });
    await link2.resume(null);
    await settle();
    expect(r2.batches[0]!.snapshot).toEqual(saved);
  });
});

describe('断线判负', () => {
  it('对手断开：座位广播带宽限剩余；宽限到了判负，结果原因 abandon，对手座位标 out', async () => {
    const h = hub();
    const la = h.link('alice');
    const lb = h.link('bob');
    const a = record(la);
    const { code } = await la.createMatch({ nickname: '甲', seat: seat('demacia') });
    await lb.joinMatch(code, { nickname: '乙', seat: seat('noxus') });
    await settle();
    lb.disconnect();
    await settle();
    const s = a.seats.at(-1)!.seats[1]!;
    expect(s.connected).toBe(false);
    expect(s.graceIn).toBe(60_000);
    h.room(code)!.forfeit(1 as Side, 'abandon');
    await settle();
    expect(a.batches.at(-1)!.cause).toBe('forfeit');
    expect(a.batches.at(-1)!.events.map((e) => e.kind)).toEqual(['game_over']);
    expect(a.ended[0]).toMatchObject({ reason: 'result', result: { winner: 0, reason: 'abandon' } });
    expect(a.seats.at(-1)!.seats[1]!.out).toBe(true);
    expect(await la.currentMatch()).toBeNull();
  });

  it('一个主体同时只占一局的座位；setup 拒了（卡池哈希不对）发 setup_rejected', async () => {
    const h = hub();
    const la = h.link('alice');
    const a = record(la);
    await la.createMatch({ nickname: '甲', seat: { ...seat('demacia'), poolHash: 'old' }, bots: [{ level: 'L0', heroClass: 'noxus' }] });
    await settle();
    expect(a.ended[0]).toMatchObject({ reason: 'setup_rejected', detail: 'version_mismatch', result: null });
    const lb = h.link('bob');
    await lb.createMatch({ nickname: '乙', seat: seat('noxus') });
    await expect(lb.createMatch({ nickname: '乙', seat: seat('noxus') })).rejects.toMatchObject({ code: 'already_in_match' });
  });
});
