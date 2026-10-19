// 结算页（spec 5.1）：胜负演出播完后升起，回合数、再来一局、回主菜单。
import type { GameApp } from '../app/game';
import { getUi, useUi } from '../app/store';

export function ResultPanel({ app }: { app: GameApp }) {
  const result = useUi((s) => s.result);
  const replay = useUi((s) => s.status.replay);
  if (!result) return null;
  const title = result.winner === 'draw' ? '平局' : replay ? `玩家 ${result.winner} 获胜` : result.won ? '胜利' : '失败';
  const again = () => {
    if (replay) location.reload();
    else void app.startMatch(getUi().menu.humanClass, getUi().menu.aiClass);
  };
  return (
    <div className="result-backdrop">
      <div className={`result-panel ${result.won ? 'won' : 'lost'}`}>
        <div className="result-title">{title}</div>
        <div className="result-line">共 {result.turns} 回合</div>
        <div className="result-buttons">
          <button className="hex-button" onClick={again}>
            {replay ? '重新回放' : '再来一局'}
          </button>
          <button
            className="hex-button secondary"
            onClick={() => {
              if (replay) location.href = location.pathname;
              else app.backToMenu();
            }}
          >
            回主菜单
          </button>
        </div>
      </div>
    </div>
  );
}
