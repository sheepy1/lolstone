// 对手断线横幅显示什么（src/ui/onlineBanner.ts，docs/online.md 3.4）：在线不显示；宽限没到倒数；到了 0 或者平台没给宽限时
// 显示"正在判定"，不消失（判负由平台做，可能比本地倒计时晚）。
import { describe, expect, it } from 'vitest';
import { disconnectBanner } from '../src/ui/onlineBanner';

describe('disconnectBanner', () => {
  it('在线不显示；断线倒数剩几秒；到 0 或没有宽限信息时显示正在判定', () => {
    const now = 100_000;
    expect(disconnectBanner({ opponentOffline: false, graceUntil: null }, now)).toBeNull();
    expect(disconnectBanner({ opponentOffline: false, graceUntil: now + 30_000 }, now)).toBeNull();
    expect(disconnectBanner({ opponentOffline: true, graceUntil: now + 42_300 }, now)).toEqual({ kind: 'countdown', secs: 43 });
    expect(disconnectBanner({ opponentOffline: true, graceUntil: now + 400 }, now)).toEqual({ kind: 'countdown', secs: 1 });
    expect(disconnectBanner({ opponentOffline: true, graceUntil: now }, now)).toEqual({ kind: 'judging' });
    expect(disconnectBanner({ opponentOffline: true, graceUntil: now - 65_000 }, now)).toEqual({ kind: 'judging' });
    expect(disconnectBanner({ opponentOffline: true, graceUntil: null }, now)).toEqual({ kind: 'judging' });
  });
});
