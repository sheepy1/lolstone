// 对手断线横幅显示什么（docs/online.md 3.4）。纯函数，OnlineHud 用，测试直接测它。
// - 对手在线（或已被判负、对局已结束）：不显示。
// - 断线、宽限还没到：倒数还剩几秒（向上取整，最后一秒显示 1）。
// - 宽限到了 0，或者平台的广播里没带宽限（runner 重启后恢复的广播是这样）：显示"正在判定"，直到结束广播到（结算面板接手）
//   或对手重连（座位广播 connected 变回 true，横幅清掉）。判负由平台做，可能比本地倒计时晚几十秒，这期间不能让横幅消失。
import type { OnlineMatchUi } from '../app/store';

export type BannerState = { kind: 'countdown'; secs: number } | { kind: 'judging' } | null;

export function disconnectBanner(m: Pick<OnlineMatchUi, 'opponentOffline' | 'graceUntil'>, now: number): BannerState {
  if (!m.opponentOffline) return null;
  const secs = m.graceUntil === null ? 0 : Math.ceil((m.graceUntil - now) / 1000);
  return secs > 0 ? { kind: 'countdown', secs } : { kind: 'judging' };
}
