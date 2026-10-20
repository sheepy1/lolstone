// 结算面板（spec 5.1）：胜负演出播完后升起，回合数、再来一局、回主菜单。
// 联机对局（docs/online.md 3.4）：对阵一行显示对手昵称，不显示难度；不是正常分出胜负时显示原因（对手认输、对手超时、
// 对手离开）；再来一局是再建一个房间。
// 胜利和失败两套配色：胜利亮金、有光芒；失败压暗、冷色、安静（m4-first-minutes 第 12 步：输了也不刺眼）。
import { useEffect, useRef } from 'react';
import type { AppShell } from '../app/shell';
import { getUi, useUi } from '../app/store';
import { playSfx } from '../audio';
import { Stage } from './hextech';
import type { EndReason } from '../logic/state';
import { CLASS_BLURBS, difficultyName } from './menuData';

const hover = () => playSfx('ui.hover');

// 联机对局的胜负原因，按我赢还是我输分两套说法。正常分出胜负（game）不显示
const REASON_WON: Partial<Record<EndReason, string>> = { concede: '对手认输', timeout: '对手超时', abandon: '对手离开', kicked: '对手离开', invalid_deck: '对手的卡组不合规' };
const REASON_LOST: Partial<Record<EndReason, string>> = { concede: '你认输了', timeout: '你超时了', abandon: '你断线太久，判负', kicked: '你被移出了对局', invalid_deck: '你的卡组不合规' };

export function ResultPanel({ app }: { app: AppShell }) {
  const result = useUi((s) => s.result);
  const replay = useUi((s) => s.status.replay);
  const menu = useUi((s) => s.menu);
  const online = useUi((s) => s.online?.match ?? null);
  const primary = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    busy.current = false;
    if (result) primary.current?.focus({ preventScroll: true });
  }, [result]);

  if (!result) return null;
  const tone = result.winner === 'draw' ? 'draw' : replay ? 'won' : result.won ? 'won' : 'lost';
  const title = result.winner === 'draw' ? '平局' : replay ? `玩家 ${result.winner + 1} 获胜` : result.won ? '胜利' : '失败';
  const reason = online && result.winner !== 'draw' ? (result.won ? REASON_WON : REASON_LOST)[result.reason] : undefined;
  const line =
    reason ??
    (tone === 'won' && !replay ? '峡谷是你的了' : tone === 'lost' ? '再调整一下，下一局拿回来' : tone === 'draw' ? '双方枢纽同时倒下' : '回放结束');

  const again = () => {
    if (busy.current) return;
    busy.current = true;
    playSfx('ui.button');
    if (replay) location.reload();
    else if (online) app.onlineClient?.again();
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
    else if (online) app.onlineClient?.toMenu();
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
            <div className={`rs-line ${reason ? 'rs-reason' : ''}`}>{line}</div>
            {online && (
              <div className="rs-matchup">
                {CLASS_BLURBS[online.myClass].hero}
                <span className="rs-vs">对阵</span>
                {online.opponent}
                <span className="rs-diff">{CLASS_BLURBS[online.opponentClass].hero}</span>
              </div>
            )}
            {!replay && !online && (
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
