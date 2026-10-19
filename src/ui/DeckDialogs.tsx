// 卡组页的弹窗：新建（选职业、起名）、改名、确认（删除、放弃修改）。和设置页一样：焦点困在弹窗里，Esc 取消，按键不外漏。
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { allHeroClasses, type HeroClass } from '../engine';
import { iconUrl } from '../assets/manifest';
import { playSfx } from '../audio';
import { Stage } from './hextech';
import { RadioGroup } from './RadioGroup';
import { trapFocus } from './SettingsPanel';
import { defaultDeckName } from './decks';

function Dialog({ title, onCancel, children, focus = 'input, button' }: { title: string; onCancel: () => void; children: ReactNode; focus?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }, [focus]);
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      playSfx('ui.cancel');
      onCancel();
    }
    trapFocus(e, root.current);
  };
  return (
    <div className="hx-screen ov-backdrop dk-dialog-backdrop" onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-label={title}>
      <Stage>
        <div className="hx-panel dk-dialog" ref={root}>
          <div className="dk-dialog-title">{title}</div>
          {children}
        </div>
      </Stage>
    </div>
  );
}

export function NewDeckDialog({ initialClass, onCreate, onCancel }: { initialClass: HeroClass; onCreate: (cls: HeroClass, name: string) => void; onCancel: () => void }) {
  const [cls, setCls] = useState<HeroClass>(initialClass);
  const [name, setName] = useState(() => defaultDeckName(initialClass));
  const [touched, setTouched] = useState(false);
  const classes = allHeroClasses();
  const pick = (c: HeroClass) => {
    playSfx('ui.click');
    setCls(c);
    if (!touched) setName(defaultDeckName(c));
  };
  return (
    <Dialog title="新建卡组" onCancel={onCancel} focus="[role='radio'][aria-checked='true']">
      <div className="dk-field-label">职业</div>
      <div className="dk-class-pick">
        <RadioGroup
          label="职业"
          items={classes.map((c) => c.id)}
          value={cls}
          onChange={pick}
          render={(id, checked, props) => {
            const c = classes.find((x) => x.id === id)!;
            return (
              <button key={id} className={`dk-class region-${id} ${checked ? 'on' : ''}`} {...props}>
                <span className="dk-class-icon" style={{ backgroundImage: `url(${iconUrl(c.champion)})` }} />
                {c.name}
              </button>
            );
          }}
        />
      </div>
      <label className="dk-field-label" htmlFor="dk-new-name">
        名字
      </label>
      <input
        id="dk-new-name"
        className="dk-input"
        value={name}
        maxLength={16}
        onChange={(e) => {
          setTouched(true);
          setName(e.target.value);
        }}
        onKeyDown={(e) => {
          // 拦下这次 Enter 的默认行为：否则新打开的编辑页聚焦到第一张卡后，同一次按键会把它点进卡组
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (name.trim()) onCreate(cls, name);
        }}
      />
      <div className="dk-dialog-buttons">
        <button className="hx-btn" onClick={onCancel}>
          取消
        </button>
        <button className="hx-cta dk-dialog-ok" disabled={!name.trim()} onClick={() => onCreate(cls, name)}>
          <span className="hx-cta-text">创建</span>
        </button>
      </div>
    </Dialog>
  );
}

export function RenameDialog({ name, onRename, onCancel }: { name: string; onRename: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name);
  return (
    <Dialog title="改名" onCancel={onCancel}>
      <input
        className="dk-input"
        value={value}
        maxLength={16}
        aria-label="卡组名字"
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (value.trim()) onRename(value);
        }}
      />
      <div className="dk-dialog-buttons">
        <button className="hx-btn" onClick={onCancel}>
          取消
        </button>
        <button className="hx-cta dk-dialog-ok" disabled={!value.trim()} onClick={() => onRename(value)}>
          <span className="hx-cta-text">确定</span>
        </button>
      </div>
    </Dialog>
  );
}

// 确认弹窗。默认焦点在"取消"（或第一个不危险的按钮），顺手按 Enter 不会直接删掉
export function ConfirmDialog({
  title,
  text,
  actions,
  onCancel,
}: {
  title: string;
  text: string;
  actions: { label: string; danger?: boolean; onClick: () => void }[];
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} onCancel={onCancel} focus=".dk-cancel">
      <div className="dk-confirm-text">{text}</div>
      <div className="dk-dialog-buttons">
        <button className="hx-btn dk-cancel" onClick={onCancel}>
          取消
        </button>
        {actions.map((a) => (
          <button key={a.label} className={`hx-btn ${a.danger ? 'dk-danger' : ''}`} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
