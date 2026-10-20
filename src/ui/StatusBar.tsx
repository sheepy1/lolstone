// 左上角的小状态条：快进提示、对局菜单（回放时直接回主菜单）。
import type { AppShell } from '../app/shell';
import { useUi } from '../app/store';

export function StatusBar({ app }: { app: AppShell }) {
  const status = useUi((s) => s.status);
  return (
    <div className="status-bar">
      <button className="status-menu" onClick={() => (status.replay ? (location.href = location.pathname) : app.openPanel('pause'))}>
        菜单
      </button>
      {status.replay && <span className="status-chip">回放</span>}
      {status.busy && <span className="status-chip">{status.speed > 1 ? `快进 ×${status.speed}` : '点击或空格快进'}</span>}
    </div>
  );
}
