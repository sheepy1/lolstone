// 设置页（spec 5.1）：四条音量、动画速度、AI 难度的默认值、恢复默认。主菜单和对局菜单都能打开；对局中打开时游戏暂停
// （GameApp.openPanel）。拖音效音量时试放一声短音效，拖语音音量时试放一句当前职业英雄的语音。
// 键盘：Tab 在控件间移动（焦点困在面板里），滑杆用方向键调，单选组用方向键选，Esc 关闭。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { GameApp } from '../app/game';
import { setUi, useUi } from '../app/store';
import { getVolumes, onVolumeChange, playSfx, playVoice, preloadVoice, setVolume, type Channel, type Volumes } from '../audio';
import { getHeroClass } from '../engine';
import { Stage } from './hextech';
import { DIFFICULTIES, type Difficulty } from './menuData';
import { RadioGroup } from './RadioGroup';
import { ANIM_SPEEDS, auditionLog, getSettings, onSettingsChange, setSettings, SETTINGS_DEFAULTS, VOLUME_DEFAULTS, type AnimSpeed } from './settings';

const CHANNELS: { id: Channel; name: string }[] = [
  { id: 'master', name: '主音量' },
  { id: 'music', name: '音乐' },
  { id: 'sfx', name: '音效' },
  { id: 'voice', name: '语音' },
];

// 试放的最短间隔：拖动时不连成一片
const SFX_GAP_MS = 160;
const VOICE_GAP_MS = 1400;

function useVolumes(): Volumes {
  const [v, setV] = useState(getVolumes);
  useEffect(() => onVolumeChange(setV), []);
  return v;
}

function useSettings() {
  const [s, setS] = useState(getSettings);
  useEffect(() => onSettingsChange(setS), []);
  return s;
}

// 焦点困在面板里：Tab 到最后一个控件再按 Tab 回到第一个，Shift+Tab 反过来
export function trapFocus(e: KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return;
  const items = [...root.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')].filter((el) => !el.hasAttribute('disabled'));
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function SettingsPanel({ app }: { app: GameApp }) {
  const volumes = useVolumes();
  const settings = useSettings();
  const humanClass = useUi((s) => s.menu.humanClass);
  const inMatch = useUi((s) => s.screen === 'match');
  const root = useRef<HTMLDivElement>(null);
  const lastAudition = useRef<Record<string, number>>({});
  const champion = getHeroClass(humanClass).champion;

  useEffect(() => {
    void preloadVoice(champion, 'choose');
    root.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }, [champion]);

  const audition = (channel: Channel) => {
    if (channel !== 'sfx' && channel !== 'voice') return;
    const now = performance.now();
    const gap = channel === 'sfx' ? SFX_GAP_MS : VOICE_GAP_MS;
    if (now - (lastAudition.current[channel] ?? -Infinity) < gap) return;
    lastAudition.current[channel] = now;
    auditionLog.push({ channel, at: Date.now() });
    if (channel === 'sfx') playSfx('card.land');
    else playVoice(champion, 'choose');
  };

  const changeVolume = (channel: Channel, value: number) => {
    setVolume(channel, value);
    audition(channel);
  };

  const pickDifficulty = (d: Difficulty) => {
    playSfx('ui.click');
    setSettings({ difficulty: d });
    setUi((s) => ({ menu: { ...s.menu, difficulty: d } }));
  };

  const pickSpeed = (id: string) => {
    playSfx('ui.click');
    setSettings({ animSpeed: Number(id) as AnimSpeed });
  };

  const reset = () => {
    playSfx('ui.button');
    for (const c of CHANNELS) setVolume(c.id, VOLUME_DEFAULTS[c.id]);
    setSettings({ ...SETTINGS_DEFAULTS });
    setUi((s) => ({ menu: { ...s.menu, difficulty: SETTINGS_DEFAULTS.difficulty } }));
  };

  const close = () => {
    playSfx('ui.click');
    app.closePanel();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // 不让按键漏到对局的键盘处理（空格快进、Esc 取消）和主菜单（Enter 开始）
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    trapFocus(e, root.current);
  };

  return (
    <div className="hx-screen ov-backdrop" onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-label="设置">
      <Stage>
        <div className="hx-panel ov-settings" ref={root}>
          <div className="ov-title">设置</div>
          {inMatch && <div className="ov-paused">游戏已暂停</div>}

          <section className="ov-section">
            <div className="ov-section-label">音量</div>
            {CHANNELS.map((c) => {
              const pct = Math.round(volumes[c.id] * 100);
              return (
                <label key={c.id} className="ov-slider-row">
                  <span className="ov-slider-name">{c.name}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={pct}
                    className="ov-slider"
                    style={{ ['--pct' as string]: `${pct}%` }}
                    aria-label={c.name}
                    onChange={(e) => changeVolume(c.id, Number(e.target.value) / 100)}
                  />
                  <span className="ov-slider-value">{pct}</span>
                </label>
              );
            })}
          </section>

          <section className="ov-section ov-row">
            <div className="ov-section-label">动画速度</div>
            <RadioGroup
              label="动画速度"
              items={ANIM_SPEEDS.map((s) => String(s.id))}
              value={String(settings.animSpeed)}
              onChange={pickSpeed}
              render={(id, checked, props) => {
                const s = ANIM_SPEEDS.find((x) => String(x.id) === id)!;
                return (
                  <button key={id} className={`ov-seg ${checked ? 'on' : ''}`} {...props}>
                    {s.name}
                    {s.id !== 1 && <span className="ov-seg-sub">×{s.id}</span>}
                  </button>
                );
              }}
            />
          </section>
          <div className="ov-note">点击棋盘或按空格的快进始终是三倍速</div>

          <section className="ov-section ov-row">
            <div className="ov-section-label">AI 难度</div>
            <RadioGroup
              label="AI 难度"
              items={DIFFICULTIES.map((d) => d.id)}
              value={settings.difficulty}
              onChange={pickDifficulty}
              render={(id, checked, props) => (
                <button key={id} className={`ov-seg ${checked ? 'on' : ''}`} {...props}>
                  {DIFFICULTIES.find((d) => d.id === id)!.name}
                </button>
              )}
            />
          </section>
          <div className="ov-note">{inMatch ? '下一局开始时生效' : DIFFICULTIES.find((d) => d.id === settings.difficulty)!.note}</div>

          <div className="ov-buttons">
            <button className="hx-btn ov-reset" onClick={reset}>
              恢复默认
            </button>
            <button className="hx-cta ov-done" onClick={close}>
              <span className="hx-cta-text">完成</span>
            </button>
          </div>
        </div>
      </Stage>
    </div>
  );
}
