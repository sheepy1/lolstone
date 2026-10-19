// 结算面板（spec 5.1）：胜负演出播完后升起，回合数、再来一局、回主菜单。
// 胜利和失败两套配色：胜利亮金、有光芒；失败压暗、冷色、安静（m4-first-minutes 第 12 步：输了也不刺眼）。
import { useEffect, useRef } from 'react';
import type { GameApp } from '../app/game';
import { getUi, useUi } from '../app/store';
import { playSfx } from '../audio';
import { Stage } from './hextech';
import { CLASS_BLURBS, difficultyName } from './menuData';

const hover = () => playSfx('ui.hover');

export function ResultPanel({ app }: { app: GameApp }) {
  const result = useUi((s) => s.result);
  const replay = useUi((s) => s.status.replay);
  const menu = useUi((s) => s.menu);
  const primary = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    busy.current = false;
    if (result) primary.current?.focus({ preventScroll: true });
  }, [result]);

  if (!result) return null;
  const tone = result.winner === 'draw' ? 'draw' : replay ? 'won' : result.won ? 'won' : 'lost';
  const title = result.winner === 'draw' ? '平局' : replay ? `玩家 ${result.winner + 1} 获胜` : result.won ? '胜利' : '失败';
  const line =
    tone === 'won' && !replay ? '峡谷是你的了' : tone === 'lost' ? '再调整一下，下一局拿回来' : tone === 'draw' ? '双方枢纽同时倒下' : '回放结束';

  const again = () => {
    if (busy.current) return;
    busy.current = true;
    playSfx('ui.button');
    if (replay) location.reload();
    else {
      const m = getUi().menu;
      void app.startMatch(m.humanClass, m.aiClass, undefined, m.difficulty, m.humanDeck);
    }
  };
  const toMenu = () => {
    if (busy.current) return;
    busy.current = true;
    playSfx('ui.click');
    if (replay) location.href = location.pathname;
    else app.backToMenu();
  };

  return (
    <div className={`hx-screen rs-backdrop rs-${tone}`}>
      <div className="rs-wash" />
      <Stage>
        <div className="rs-wrap">
          {tone === 'won' && <div className="rs-rays" aria-hidden />}
          <div className="rs-title" role="heading" aria-level={1}>
            {title}
          </div>
          <div className="hx-panel rs-panel">
            <div className="rs-line">{line}</div>
            {!replay && (
              <div className="rs-matchup">
                {CLASS_BLURBS[menu.humanClass].hero}
                <span className="rs-vs">对阵</span>
                {CLASS_BLURBS[menu.aiClass].hero}
                <span className="rs-diff">{difficultyName(menu.difficulty)}</span>
              </div>
            )}
            <div className="rs-stats">
              <div className="rs-stat">
                <span className="rs-stat-num">{result.turns}</span>
                <span className="rs-stat-label">回合</span>
              </div>
            </div>
            <div className="rs-buttons">
              <button ref={primary} className="hx-cta rs-again" onClick={again} onPointerEnter={hover}>
                <span className="hx-cta-text">{replay ? '重新回放' : '再来一局'}</span>
              </button>
              <button className="hx-btn rs-menu" onClick={toMenu} onPointerEnter={hover}>
                回主菜单
              </button>
            </div>
          </div>
        </div>
      </Stage>
    </div>
  );
}
