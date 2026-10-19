// 换牌页（spec 5.1）：起手牌在画布中央翻开（Pixi），点牌标记替换，这里只画说明和确认按钮。
import type { GameApp } from '../app/game';
import { useUi } from '../app/store';

export function MulliganOverlay({ app }: { app: GameApp }) {
  const { open, marked } = useUi((s) => s.mulligan);
  if (!open) return null;
  return (
    <div className="mulligan-overlay">
      <div className="mulligan-title">选择要替换的起手牌</div>
      <div className="mulligan-hint">点击卡牌标记替换，再点一次取消。法力药水不能换。</div>
      <button className="hex-button" onClick={() => app.confirmMulligan()}>
        {marked > 0 ? `替换 ${marked} 张` : '保留全部'}
      </button>
    </div>
  );
}
