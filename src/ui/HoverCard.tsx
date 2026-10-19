// 悬停时的关键词解释（spec 5.3、5.4）。指针停在随从的关键词图标上时，那个关键词排最前、高亮（scene/keywordHover.ts）。放大的卡面在场景里（TableScene.showInspect），这里只用 DOM 画说明文字，
// 贴在放大卡下面；悬停手牌时（手牌自己抬起放大）贴在画面左侧。
import { getCard, MANA_POTION_ID } from '../engine';
import { useUi } from '../app/store';
import { KEYWORD_HELP } from '../presentation/keywordText';

export function HoverCardPanel() {
  const hover = useUi((s) => s.hover);
  if (!hover || hover.cardId === 'hidden') return null;
  const def = getCard(hover.cardId);
  const stats = hover.stats;
  const focus = hover.keyword ?? null;
  const help = Object.entries(KEYWORD_HELP).filter(
    ([k]) => k === focus || def.text.includes(k) || stats?.keywords.includes(k) || (k === '冻结' && stats?.frozen) || (k === '沉默' && stats?.silenced),
  );
  // 指针停在某个关键词图标上时，那一条排最前、高亮
  if (focus) help.sort(([a], [b]) => Number(b === focus) - Number(a === focus));
  const status = stats ? [...stats.keywords, stats.frozen ? '冻结' : '', stats.silenced ? '已沉默' : ''].filter(Boolean) : [];
  // 法力药水：后手开局多拿的那张。换牌时它单独放着、不能换，悬停时说明为什么（m4-first-minutes 第 4 步）
  const potion = hover.cardId === MANA_POTION_ID;
  if (help.length === 0 && status.length === 0 && !potion) return null;
  const a = hover.anchor;
  const style = a ? { left: a.left, top: a.top + 8, width: Math.max(240, a.width) } : undefined;
  return (
    <div className="keyword-panel" style={style}>
      {potion && (
        <div className="keyword-help focus">
          <b>法力药水 · 后手补偿</b>：后手的一方开局多拿这一张，换牌时不能换。0 费，打出后这个回合多一个法力水晶，可以提前一回合打出费用多一点的牌。
        </div>
      )}
      {status.length > 0 && <div className="keyword-help">当前：{status.join('、')}</div>}
      {help.map(([k, v]) => (
        <div key={k} className={k === focus ? 'keyword-help focus' : 'keyword-help'}>
          <b>{k}</b>：{v}
        </div>
      ))}
    </div>
  );
}
