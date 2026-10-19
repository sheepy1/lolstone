// 悬停时的关键词解释（spec 5.3）。放大的卡面在场景里（TableScene.showInspect），这里只用 DOM 画说明文字，
// 贴在放大卡下面；悬停手牌时（手牌自己抬起放大）贴在画面左侧。
import { getCard } from '../engine';
import { useUi } from '../app/store';
import { KEYWORD_HELP } from '../presentation/keywordText';

export function HoverCardPanel() {
  const hover = useUi((s) => s.hover);
  if (!hover || hover.cardId === 'hidden') return null;
  const def = getCard(hover.cardId);
  const stats = hover.stats;
  const help = Object.entries(KEYWORD_HELP).filter(
    ([k]) => def.text.includes(k) || stats?.keywords.includes(k) || (k === '冻结' && stats?.frozen) || (k === '沉默' && stats?.silenced),
  );
  const status = stats ? [...stats.keywords, stats.frozen ? '冻结' : '', stats.silenced ? '已沉默' : ''].filter(Boolean) : [];
  if (help.length === 0 && status.length === 0) return null;
  const a = hover.anchor;
  const style = a ? { left: a.left, top: a.top + 8, width: Math.max(240, a.width) } : undefined;
  return (
    <div className="keyword-panel" style={style}>
      {status.length > 0 && <div className="keyword-help">当前：{status.join('、')}</div>}
      {help.map(([k, v]) => (
        <div key={k} className="keyword-help">
          <b>{k}</b>：{v}
        </div>
      ))}
    </div>
  );
}
