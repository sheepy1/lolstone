// 主菜单（spec 5.1）：选职业和 AI 职业，开始。第一版用预组卡组，AI 先只有 L0。
import { PRESET_DECKS } from '../cards';
import { allHeroClasses, type HeroClass } from '../engine';
import type { GameApp } from '../app/game';
import { setUi, useUi } from '../app/store';
import { initAudio } from '../audio';

export function MainMenu({ app }: { app: GameApp }) {
  const menu = useUi((s) => s.menu);
  const classes = allHeroClasses().filter((c) => PRESET_DECKS[c.id]);
  const pick = (key: 'humanClass' | 'aiClass', id: HeroClass) => {
    initAudio();
    setUi((s) => ({ menu: { ...s.menu, [key]: id } }));
  };
  return (
    <div className="screen menu-screen" onPointerDown={() => initAudio()}>
      <div className="logo">MeLoL</div>
      <div className="subtitle">峡谷战局</div>
      <div className="menu-row">
        <span className="menu-label">你的职业</span>
        {classes.map((c) => (
          <button key={c.id} className={`chip ${menu.humanClass === c.id ? 'on' : ''}`} onClick={() => pick('humanClass', c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="menu-row">
        <span className="menu-label">对手职业</span>
        {classes.map((c) => (
          <button key={c.id} className={`chip ${menu.aiClass === c.id ? 'on' : ''}`} onClick={() => pick('aiClass', c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="menu-row">
        <span className="menu-label">AI 难度</span>
        <button className="chip on">L0 随机</button>
      </div>
      <button className="hex-button" onClick={() => void app.startMatch(menu.humanClass, menu.aiClass)}>
        开始对局
      </button>
      <a className="menu-link" href="?replay">
        观看回放夹具（L0 对 L0）
      </a>
    </div>
  );
}
