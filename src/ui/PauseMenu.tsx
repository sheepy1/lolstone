// 对局菜单：左上角"菜单"按钮或 Esc 打开，游戏暂停。里面有继续、设置、认输、回主菜单；认输和回主菜单要再确认一次。
// 联机对局里回主菜单等于认输（docs/online.md 3.4），确认文案说明这一点。
// Esc：没有面板时打开对局菜单；在对局菜单里关掉它（确认步骤里先退回列表）；设置页自己处理 Esc，关掉后回到这里。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppShell } from '../app/shell';
import { getUi, useUi } from '../app/store';
import { playSfx } from '../audio';
import { trapFocus } from './SettingsPanel';

type Confirm = 'concede' | 'menu' | null;

const hover = () => playSfx('ui.hover');

// 对局中按 Esc 打开对局菜单（结算面板出现后、回放时不响应）。面板打开时按键由面板自己处理并拦下，不会走到这里。
export function useEscOpensPauseMenu(app: AppShell): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const ui = getUi();
      if (ui.screen !== 'match' || ui.panels.length > 0 || ui.result || ui.status.replay) return;
      e.preventDefault();
      playSfx('ui.click');
      app.openPanel('pause');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);
}

export function PauseMenu({ app }: { app: AppShell }) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const top = useUi((s) => s.panels[s.panels.length - 1]);
  const online = useUi((s) => !!s.online?.match);
  const root = useRef<HTMLDivElement>(null);
  const active = top === 'pause';

  // 打开、从设置页回来时，焦点放到第一个按钮；确认步骤里放到"取消"上，顺手按 Enter 不会直接认输
  useEffect(() => {
    if (active) root.current?.querySelector<HTMLElement>(confirm ? '.ov-item.cancel' : 'button')?.focus({ preventScroll: true });
  }, [active, confirm]);

  const resume = () => {
    playSfx('ui.click');
    app.closePanel(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (confirm) {
        playSfx('ui.cancel');
        setConfirm(null);
      } else resume();
    }
    trapFocus(e, root.current);
  };

  return (
    <div className={`hx-screen ov-backdrop ov-pause-backdrop ${active ? '' : 'covered'}`} onKeyDown={onKeyDown} onPointerDown={(e) => e.target === e.currentTarget && resume()}>
      <div className="ov-paused-banner" aria-hidden>
        游戏已暂停
      </div>
      <div className="hx-panel ov-pause" ref={root} role="dialog" aria-modal="true" aria-label="对局菜单">
        {confirm === null && (
          <>
            <div className="ov-pause-title">对局菜单</div>
            <button className="ov-item primary" onClick={resume} onPointerEnter={hover}>
              继续游戏<kbd>Esc</kbd>
            </button>
            <button
              className="ov-item"
              onPointerEnter={hover}
              onClick={() => {
                playSfx('ui.click');
                app.openPanel('settings');
              }}
            >
              设置
            </button>
            <button
              className="ov-item danger"
              onPointerEnter={hover}
              onClick={() => {
                playSfx('ui.click');
                setConfirm('concede');
              }}
            >
              认输
            </button>
            <button
              className="ov-item"
              onPointerEnter={hover}
              onClick={() => {
                playSfx('ui.click');
                setConfirm('menu');
              }}
            >
              回主菜单
            </button>
          </>
        )}
        {confirm !== null && (
          <>
            <div className="ov-pause-title">{confirm === 'concede' ? '确定认输？' : '回到主菜单？'}</div>
            <div className="ov-confirm-text">{confirm === 'concede' ? '本局记为失败，对手获胜。' : online ? '离开就算认输，对手获胜。' : '这一局会直接结束，不保存进度。'}</div>
            <button
              className="ov-item danger"
              onPointerEnter={hover}
              onClick={() => {
                playSfx('ui.button');
                if (confirm === 'concede') app.concede();
                else app.backToMenu();
              }}
            >
              {confirm === 'concede' ? '认输' : '回主菜单'}
            </button>
            <button
              className="ov-item cancel"
              onPointerEnter={hover}
              onClick={() => {
                playSfx('ui.cancel');
                setConfirm(null);
              }}
            >
              取消
            </button>
          </>
        )}
      </div>
    </div>
  );
}
