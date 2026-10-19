// 主菜单（spec 5.1）：选我方职业（第一版用预组卡组）、AI 职业和难度，开始。
// 整页能用键盘操作：Tab 在三组选项和开始按钮之间切换，方向键在组内选择，Enter 随时开始对局。
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { PRESET_DECKS } from '../cards';
import { allHeroClasses, type HeroClassDef } from '../engine';
import type { GameApp } from '../app/game';
import { setUi, useUi } from '../app/store';
import { iconUrl, loadingArtUrl } from '../assets/manifest';
import { initAudio, playMusic, playSfx } from '../audio';
import { MenuBackdrop, Stage } from './hextech';
import { CLASS_BLURBS, DIFFICULTIES } from './menuData';

// 第一次点击或按键之后浏览器才允许出声（spec 5.7），那时再起菜单音乐；从对局回到主菜单时直接起。
let audioUnlocked = false;
function unlockAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  initAudio();
  playMusic('menu');
}

const hover = () => playSfx('ui.hover');

export function MainMenu({ app }: { app: GameApp }) {
  const menu = useUi((s) => s.menu);
  const classes = allHeroClasses().filter((c) => PRESET_DECKS[c.id]);
  const started = useRef(false);
  const firstCard = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (audioUnlocked) playMusic('menu');
    // 进页面就把焦点放在已选的职业卡上，方向键马上能用
    firstCard.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, []);

  const pick = <K extends 'humanClass' | 'aiClass' | 'difficulty'>(key: K, id: (typeof menu)[K]) => {
    if (menu[key] === id) return;
    playSfx('ui.click');
    setUi((s) => ({ menu: { ...s.menu, [key]: id } }));
  };

  const start = () => {
    if (started.current) return;
    started.current = true;
    unlockAudio();
    playSfx('ui.button');
    void app.startMatch(menu.humanClass, menu.aiClass, undefined, menu.difficulty);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    unlockAudio();
    if (e.key === 'Enter') {
      e.preventDefault();
      start();
    }
  };

  const me = CLASS_BLURBS[menu.humanClass];
  const foe = CLASS_BLURBS[menu.aiClass];

  return (
    <div className="hx-screen mm-screen" onPointerDown={unlockAudio} onKeyDown={onKeyDown}>
      <MenuBackdrop />
      <Stage>
        <header className="mm-title">
          <div className="hx-logo">MeLoL</div>
          <div className="hx-subtitle">峡 谷 战 局</div>
        </header>

        <SectionLabel top={262}>选择你的职业</SectionLabel>
        <div className="mm-classes" ref={firstCard}>
          <RadioGroup
            label="你的职业"
            items={classes.map((c) => c.id)}
            value={menu.humanClass}
            onChange={(id) => pick('humanClass', id)}
            render={(id, checked, props, i) => (
              <ClassCard key={id} def={classes.find((c) => c.id === id)!} checked={checked} index={i} props={props} />
            )}
          />
        </div>

        <div className="hx-panel mm-bar">
          <div className="mm-field">
            <div className="mm-field-label">对手职业</div>
            <div className="mm-foes">
              <RadioGroup
                label="对手职业"
                items={classes.map((c) => c.id)}
                value={menu.aiClass}
                onChange={(id) => pick('aiClass', id)}
                render={(id, checked, props) => (
                  <button key={id} className={`mm-foe region-${id} ${checked ? 'on' : ''}`} {...props}>
                    <span className="mm-foe-icon" style={{ backgroundImage: `url(${iconUrl(classes.find((c) => c.id === id)!.champion)})` }} />
                    <span className="mm-foe-name">{CLASS_BLURBS[id].hero}</span>
                  </button>
                )}
              />
            </div>
          </div>

          <div className="mm-divider" />

          <div className="mm-field">
            <div className="mm-field-label">难度</div>
            <div className="mm-diffs">
              <RadioGroup
                label="难度"
                items={DIFFICULTIES.map((d) => d.id)}
                value={menu.difficulty}
                onChange={(id) => pick('difficulty', id)}
                render={(id, checked, props) => (
                  <button key={id} className={`mm-diff ${checked ? 'on' : ''}`} {...props}>
                    {DIFFICULTIES.find((d) => d.id === id)!.name}
                  </button>
                )}
              />
            </div>
            <div className="mm-diff-note">{DIFFICULTIES.find((d) => d.id === menu.difficulty)!.note}</div>
          </div>

          <button className="hx-cta mm-start" onClick={start} onPointerEnter={hover}>
            <span className="hx-cta-text">开始对局</span>
            <span className="hx-cta-sub">
              {me.hero} 对阵 {foe.hero}
            </span>
          </button>
        </div>

        <footer className="mm-footer">
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> 选择 · <kbd>Tab</kbd> 切换 · <kbd>Enter</kbd> 开始对局
          </span>
          <a className="mm-replay" href="?replay" onPointerEnter={hover}>
            观看回放
          </a>
        </footer>
      </Stage>
    </div>
  );
}

function SectionLabel({ children, top }: { children: string; top: number }) {
  return (
    <div className="hx-section-label" style={{ top }}>
      <span className="hx-rule" />
      <span>{children}</span>
      <span className="hx-rule flip" />
    </div>
  );
}

function ClassCard({ def, checked, index, props }: { def: HeroClassDef; checked: boolean; index: number; props: RadioProps }) {
  const b = CLASS_BLURBS[def.id];
  return (
    <button className={`mm-card region-${def.id} ${checked ? 'on' : ''}`} style={{ ['--i' as string]: index }} {...props}>
      <span className="mm-card-frame">
        <span className="mm-card-art" style={{ backgroundImage: `url(${loadingArtUrl(def.champion)})` }} />
        <span className="mm-card-shade" />
        <span className="mm-card-info">
          <span className="mm-card-region">{def.name}</span>
          <span className="mm-card-hero">{b.hero}</span>
          <span className="mm-card-pitch">{b.pitch}</span>
          <span className="mm-card-tags">
            <span>{b.tags[0]}</span>
            <span>{b.tags[1]}</span>
            <span className="mm-card-power">技能 · {b.heroPower}</span>
          </span>
        </span>
      </span>
      <span className="mm-card-check" aria-hidden>
        已选
      </span>
    </button>
  );
}

type RadioProps = {
  role: 'radio';
  'aria-checked': boolean;
  tabIndex: number;
  onClick: () => void;
  onPointerEnter: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
};

// 单选组：选中的那一项可以 Tab 到，方向键在组内移动并直接选中（WAI-ARIA radio group 的做法）。
function RadioGroup<T extends string>({
  label,
  items,
  value,
  onChange,
  render,
}: {
  label: string;
  items: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (item: T, checked: boolean, props: RadioProps, index: number) => ReactNode;
}) {
  const move = (e: KeyboardEvent<HTMLElement>, from: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next: number | null = step === undefined ? null : (from + step + items.length) % items.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(items[next]!);
    const group = e.currentTarget.closest('[role="radiogroup"]');
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="hx-radiogroup">
      {items.map((item, i) =>
        render(
          item,
          item === value,
          {
            role: 'radio',
            'aria-checked': item === value,
            tabIndex: item === value ? 0 : -1,
            onClick: () => onChange(item),
            onPointerEnter: hover,
            onKeyDown: (e) => move(e, i),
          },
          i,
        ),
      )}
    </div>
  );
}
