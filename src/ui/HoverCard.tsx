// 悬停放大卡面（spec 5.3）：悬停场上随从、手牌或英雄技能时，左侧显示完整卡面，带关键词解释。
import { championOf, loadingArtUrl } from '../assets/manifest';
import { getCard } from '../engine';
import { useUi } from '../app/store';
import { KEYWORD_HELP } from '../presentation/keywordText';

const CLASS_NAMES: Record<string, string> = {
  neutral: '中立',
  demacia: '德玛西亚',
  noxus: '诺克萨斯',
  ionia: '艾欧尼亚',
  freljord: '弗雷尔卓德',
};

export function HoverCardPanel() {
  const hover = useUi((s) => s.hover);
  if (!hover || hover.cardId === 'hidden') return null;
  const def = getCard(hover.cardId);
  const champ = championOf(hover.cardId);
  const stats = hover.stats;
  const help = Object.entries(KEYWORD_HELP).filter(
    ([k]) => def.text.includes(k) || stats?.keywords.includes(k) || (k === '冻结' && stats?.frozen) || (k === '沉默' && stats?.silenced),
  );
  const atk = stats?.attack ?? def.attack;
  const hp = stats?.health ?? def.health;
  const cls = (cur: number | undefined, base: number | undefined, damaged = false) =>
    cur === undefined || base === undefined ? '' : damaged ? 'down' : cur > base ? 'up' : cur < base ? 'down' : '';
  return (
    <div className="hover-panel">
      <div className={`big-card region-${def.class} ${champ ? 'champion' : ''}`}>
        <div className="big-cost">{def.cost}</div>
        <div className="big-art">
          {champ ? <img src={loadingArtUrl(champ)} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} /> : null}
        </div>
        <div className="big-name">{def.name}</div>
        <div className="big-type">
          {CLASS_NAMES[def.class]} · {def.type === 'minion' ? '随从' : def.type === 'spell' ? '法术' : '英雄技能'}
        </div>
        <div className="big-text">{def.text || ' '}</div>
        {def.type === 'minion' && (
          <>
            <div className={`big-atk ${cls(atk, def.attack)}`}>{atk}</div>
            <div className={`big-hp ${cls(hp, def.health, !!stats && stats.health < stats.maxHealth)}`}>{hp}</div>
          </>
        )}
      </div>
      {stats && (stats.keywords.length > 0 || stats.frozen || stats.silenced) && (
        <div className="big-status">
          当前：{[...stats.keywords, stats.frozen ? '冻结' : '', stats.silenced ? '已沉默' : ''].filter(Boolean).join('、')}
        </div>
      )}
      {help.map(([k, v]) => (
        <div key={k} className="keyword-help">
          <b>{k}</b>：{v}
        </div>
      ))}
    </div>
  );
}
