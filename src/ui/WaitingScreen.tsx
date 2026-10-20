// 联机的等待页（docs/online.md 3.4）：显示邀请码、可复制；平台第一次请求可能要等几秒（runner 睡着），先显示"正在连接"；
// 对手进来后双方自动进加载页。取消就放掉座位回主菜单。
import { useEffect, useState } from 'react';
import type { AppShell } from '../app/shell';
import { useUi } from '../app/store';
import { playSfx } from '../audio';
import { MenuBackdrop, Stage } from './hextech';

const hover = () => playSfx('ui.hover');

export function WaitingScreen({ app }: { app: AppShell }) {
  const room = useUi((s) => s.online?.room ?? null);
  const [copied, setCopied] = useState(false);
  const code = room?.code ?? null;

  useEffect(() => setCopied(false), [code]);

  const copy = () => {
    if (!code) return;
    playSfx('ui.click');
    navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const cancel = () => {
    playSfx('ui.cancel');
    void app.onlineClient?.cancel();
  };

  const status = !code ? '正在连接服务器' : room?.joined ? '对手已进入，正在开局' : '把邀请码发给朋友，对手进来后自动开始';
  return (
    <div className="hx-screen wt-screen">
      <MenuBackdrop />
      <Stage>
        <header className="wt-title">
          <div className="hx-logo">联机对战</div>
          <div className="hx-subtitle">等 待 对 手</div>
        </header>
        <div className="hx-panel wt-panel">
          <div className="wt-label">邀请码</div>
          <div className={`wt-code ${code ? '' : 'pending'}`} aria-live="polite">
            {(code ?? '······').split('').map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </div>
          <button className="hx-btn wt-copy" disabled={!code} onClick={copy} onPointerEnter={hover}>
            {copied ? '已复制' : '复制邀请码'}
          </button>
          <div className={`wt-status ${room?.joined ? 'joined' : ''}`} role="status">
            {status}
            <span className="wt-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </div>
          <button className="hx-btn wt-cancel" onClick={cancel} onPointerEnter={hover}>
            取消
          </button>
        </div>
      </Stage>
    </div>
  );
}
