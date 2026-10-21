// 联机对局里叠在画面上的两样东西（docs/online.md 3.4）：
// - 回合倒计时：贴在结束回合按钮下面，最后 15 秒出现，逐秒缩短，最后 5 秒变红（音效以后做）。双方都看得到。
// - 对手断线横幅：顶部"对手已断线，xx 秒后判负"；倒计时到 0 后不消失，改成"正在判定……"，直到结束广播或对手重连
//   （平台的判负可能晚到，比如撞上 runner 重启；判定文案由 onlineBanner.ts 决定）。
// 计时用平台发来的 deadlineIn 换算成的本地到期时刻，本地时钟倒数（online.md 5.3）。
import { useEffect, useState } from 'react';
import type { AppShell } from '../app/shell';
import { useUi } from '../app/store';
import { disconnectBanner } from './onlineBanner';

// 回合倒计时最后多少秒出现、最后多少秒变红
const SHOW_MS = 15_000;
const URGENT_S = 5;

function useNow(active: boolean, every = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

export function OnlineHud({ app }: { app: AppShell }) {
  const m = useUi((s) => s.online?.match ?? null);
  const over = useUi((s) => s.result !== null);
  const active = !!m && !over && (m.deadline !== null || m.opponentOffline);
  const now = useNow(active);
  if (!m || over) return null;
  const banner = disconnectBanner(m, now);
  return (
    <>
      {m.phase === 'playing' && m.deadline !== null && <TurnTimer app={app} remaining={m.deadline - now} />}
      {banner && (
        <div className="ol-banner" role="status">
          {banner.kind === 'countdown' ? (
            <>
              对手已断线，<b>{banner.secs}</b> 秒后判负
            </>
          ) : (
            '对手已断线，正在判定……'
          )}
        </div>
      )}
    </>
  );
}

function TurnTimer({ app, remaining }: { app: AppShell; remaining: number }) {
  if (remaining > SHOW_MS || remaining <= 0) return null;
  const anchor = app.endTurnAnchor();
  if (!anchor) return null;
  const secs = Math.ceil(remaining / 1000);
  return (
    <div
      className={`ol-fuse ${secs <= URGENT_S ? 'urgent' : ''}`}
      style={{ left: anchor.x - anchor.width / 2, top: anchor.y, width: anchor.width }}
      role="timer"
      aria-label={`回合剩余 ${secs} 秒`}
    >
      <div className="ol-fuse-track">
        <div className="ol-fuse-burn" style={{ width: `${(secs / (SHOW_MS / 1000)) * 100}%` }}>
          <span className="ol-fuse-spark" />
        </div>
      </div>
      <span className="ol-fuse-num">{secs}</span>
    </div>
  );
}
