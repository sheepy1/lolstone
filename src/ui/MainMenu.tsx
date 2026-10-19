// 主菜单（spec 5.1）：选我方职业（第一版用预组卡组）、AI 职业和难度，开始。
// 整页能用键盘操作：Tab 在三组选项和开始按钮之间切换，方向键在组内选择，Enter 随时开始对局。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PRESET_DECKS } from '../cards';
import { allHeroClasses, type HeroClassDef } from '../engine';
import type { GameApp } from '../app/game';
import { setUi, useUi } from '../app/store';
import { iconUrl, loadingArtUrl } from '../assets/manifest';
import { initAudio, playMusic, playSfx } from '../audio';
import { MenuBackdrop, Stage } from './hextech';
import { CLASS_BLURBS, DIFFICULTIES } from './menuData';
import { RadioGroup, type RadioProps } from './RadioGroup';
import { setSettings } from './settings';
import { DECK_SIZE, deckProblems, isPlayable, loadDecks, onDecksChange, PRESET_STYLE } from './decks';

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
    // 换职业时卡组回到这个职业的预组
    setUi((s) => ({ menu: { ...s.menu, [key]: id, ...(key === 'humanClass' ? { humanDeck: null } : {}) } }));
    // 难度同时是设置里的默认值
    if (key === 'difficulty') setSettings({ difficulty: id as typeof menu.difficulty });
  };

  const start = () => {
    if (started.current) return;
    started.current = true;
    unlockAudio();
    playSfx('ui.button');
    void app.startMatch(menu.humanClass, menu.aiClass, undefined, menu.difficulty, deckId === 'preset' ? null : deckId);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    unlockAudio();
    // 设置按钮和回放链接上的 Enter 照常点它们自己
    if (e.key === 'Enter' && !(e.target as HTMLElement).closest('.mm-settings, .mm-decks, .mm-replay')) {
      e.preventDefault();
      start();
    }
  };

  // 这个职业的自组卡组：合规的可以选，不满 30 张或不合规的显示出来但不能选
  const [, bump] = useState(0);
  useEffect(() => onDecksChange(() => bump((n) => n + 1)), []);
  const mine = loadDecks().decks.filter((d) => d.heroClass === menu.humanClass);
  const usable = mine.filter(isPlayable);
  const deckId = usable.some((d) => d.id === menu.humanDeck) ? menu.humanDeck! : 'preset';
  const pickDeck = (id: string) => {
    if (id === deckId) return;
    playSfx('ui.click');
    setUi((s) => ({ menu: { ...s.menu, humanDeck: id === 'preset' ? null : id } }));
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

        <button
          className="hx-btn mm-decks"
          onPointerEnter={hover}
          onClick={() => {
            playSfx('ui.click');
            setUi({ screen: 'decks' });
          }}
        >
          我的卡组
        </button>
        <button
          className="hx-btn mm-settings"
          onPointerEnter={hover}
          onClick={() => {
            playSfx('ui.click');
            app.openPanel('settings');
          }}
        >
          设置
        </button>

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

        <div className="mm-deckbar">
          <span className="mm-deckbar-label">卡组</span>
          <RadioGroup
            label="卡组"
            items={['preset', ...usable.map((d) => d.id)]}
            value={deckId}
            onChange={pickDeck}
            render={(id, checked, props) => {
              const d = usable.find((x) => x.id === id);
              return (
                <button key={id} className={`mm-deck ${checked ? 'on' : ''}`} {...props}>
                  {d ? d.name : `预组 · ${PRESET_STYLE[menu.humanClass]}`}
                </button>
              );
            }}
          />
          {mine
            .filter((d) => !isPlayable(d))
            .map((d) => (
              <span key={d.id} className="mm-deck disabled" aria-disabled="true" title={deckProblems(d.cards, d.heroClass)[0]}>
                {d.name}
                <small>
                  {d.cards.length}/{DECK_SIZE}
                </small>
              </span>
            ))}
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
