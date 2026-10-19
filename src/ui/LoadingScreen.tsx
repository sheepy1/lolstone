// 加载页（spec 5.1）：进度条，背景是棋盘远景（占位：深色渐变）。
import { useUi } from '../app/store';

export function LoadingScreen() {
  const { progress, label } = useUi((s) => s.loading);
  return (
    <div className="screen loading-screen">
      <div className="logo">MeLoL</div>
      <div className="subtitle">峡谷战局</div>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="progress-label">
        {label} {Math.round(progress * 100)}%
      </div>
    </div>
  );
}
