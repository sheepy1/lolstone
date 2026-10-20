// 主菜单的联机面板（docs/online.md 3.4）：昵称、建房、凭邀请码进房。职业和卡组用主菜单上选的（预组或自组）。
// 还有没打完的局时主菜单上盖一层提示：续上还是离开（online.md 3.3）。离开了才能建房或进房。
// 只在有联机入口（ui.online 不为 null）时出现，单机的主菜单不变。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppShell } from '../app/shell';
import { setUi, useUi } from '../app/store';
import { playSfx } from '../audio';
import { Stage } from './hextech';
import { CLASS_BLURBS } from './menuData';
import { trapFocus } from './SettingsPanel';
import { deckForMatch, isPreset, PRESET_STYLE } from './decks';

const hover = () => playSfx('ui.hover');

function closePanel(): void {
  setUi((s) => (s.online ? { online: { ...s.online, open: false, notice: null } } : {}));
}

export function OnlinePanel({ app }: { app: AppShell }) {
  const online = useUi((s) => s.online);
  const menu = useUi((s) => s.menu);
  const [code, setCode] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => nameInput.current?.focus({ preventScroll: true }), []);

  const client = app.onlineClient;
  if (!online || !client) return null;
  const deck = deckForMatch(menu.humanClass, menu.humanDeck);
  const deckName = isPreset(deck.id) ? `预组 · ${PRESET_STYLE[menu.humanClass]}` : deck.name;

  const close = () => {
    playSfx('ui.cancel');
    closePanel();
  };
  const create = () => {
    if (online.busy) return;
    playSfx('ui.button');
    void client.create();
  };
  const join = () => {
    if (online.busy) return;
    playSfx('ui.button');
    void client.join(code);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    trapFocus(e, root.current);
  };
  // 输入框里按 Enter 建房或进房。要拦下默认动作：等待页一出来焦点会落到它的按钮上，同一次按键不能再"点"一下它
  const onEnter = (e: KeyboardEvent, run: () => void) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    run();
  };

  return (
    <div className="hx-screen ov-backdrop" onKeyDown={onKeyDown} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <Stage>
        <div className="hx-panel ol-panel" ref={root} role="dialog" aria-modal="true" aria-label="联机对战">
          <div className="ov-title">联机对战</div>
          <div className="ol-deck">
            出战：{CLASS_BLURBS[menu.humanClass].hero} · {deckName}
          </div>
          <label className="ol-field">
            <span className="ol-label">昵称</span>
            <input
              ref={nameInput}
              className="ol-input"
              value={online.nickname}
              maxLength={12}
              placeholder="对手会看到这个名字"
              onChange={(e) => client.setNickname(e.target.value)}
              onKeyDown={(e) => onEnter(e, create)}
            />
          </label>
          <div className="ol-actions">
            <button className="hx-cta ol-create" disabled={online.busy} onClick={create} onPointerEnter={hover}>
              <span className="hx-cta-text">建房</span>
              <span className="hx-cta-sub">拿到邀请码发给朋友</span>
            </button>
            <div className="ol-or">或者</div>
            <div className="ol-join">
              <input
                className="ol-input ol-code"
                value={code}
                maxLength={8}
                placeholder="输入邀请码"
                aria-label="邀请码"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => onEnter(e, join)}
              />
              <button className="hx-btn ol-join-btn" disabled={online.busy} onClick={join} onPointerEnter={hover}>
                进房
              </button>
            </div>
          </div>
          <div className="ol-notice" role="status">
            {online.notice ?? ''}
          </div>
          <button className="hx-btn ol-back" onClick={close} onPointerEnter={hover}>
            返回
          </button>
        </div>
      </Stage>
    </div>
  );
}

// 有没打完的局：续上，或者离开（开局了的离开就是认输）
export function ResumePrompt({ app }: { app: AppShell }) {
  const pending = useUi((s) => s.online?.pending ?? null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) root.current?.querySelector<HTMLElement>('.ol-resume-go')?.focus({ preventScroll: true });
  }, [pending]);

  const client = app.onlineClient;
  if (!pending || !client) return null;
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    trapFocus(e, root.current);
  };
  return (
    <div className="hx-screen ov-backdrop" onKeyDown={onKeyDown}>
      <Stage>
        <div className="hx-panel ol-panel ol-resume" ref={root} role="alertdialog" aria-modal="true" aria-label="还有一局没打完">
          <div className="ov-title">还有一局没打完</div>
          <div className="ol-text">{pending.started ? '对局还在进行。续上接着打，离开就算认输，对手获胜。' : `房间 ${pending.code ?? ''} 还在等对手进来。`}</div>
          <div className="ol-resume-buttons">
            <button
              className="hx-btn ol-resume-leave"
              onPointerEnter={hover}
              onClick={() => {
                playSfx('ui.cancel');
                void client.leavePending();
              }}
            >
              离开
            </button>
            <button
              className="hx-cta ol-resume-go"
              onPointerEnter={hover}
              onClick={() => {
                playSfx('ui.button');
                void client.resumePending();
              }}
            >
              <span className="hx-cta-text">续上</span>
            </button>
          </div>
        </div>
      </Stage>
    </div>
  );
}
