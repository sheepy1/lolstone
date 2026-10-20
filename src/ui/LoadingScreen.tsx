// 加载页（spec 5.1）。两种：
// - 打开页面时（screen 为 boot）：游戏名、台面远景、进度条。进度来自 main.tsx 的启动步骤（渲染器、主菜单原画、字体）。
// - 开一局时（screen 为 loading）：双方英雄原画对峙、进度条、随机小提示。进度来自 src/assets 清单的真实预载。
//   联机对局右侧的对手显示昵称和职业，不显示难度（docs/online.md 3.4）。
// 显示的进度追着真实进度走，但每秒最多走 1.6 格（整条约 0.6 秒），资源已经缓存时进度条也看得出在走，不会一跳到底。
import { useEffect, useMemo, useRef, useState } from 'react';
import { getHeroClass } from '../engine';
import { useUi } from '../app/store';
import { loadingArtUrl } from '../assets/manifest';
import { MenuBackdrop, Stage } from './hextech';
import { CLASS_BLURBS, difficultyName, randomTip } from './menuData';
import { getDeck } from './decks';

const MAX_RATE = 1.6; // 每秒最多走多少（0 到 1）

function useChasedProgress(target: number): number {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = Math.min(target, shownRef.current + MAX_RATE * dt);
      shownRef.current = next;
      setShown(next);
      if (next < target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

export function LoadingScreen({ mode }: { mode: 'boot' | 'match' }) {
  const { progress, label } = useUi((s) => s.loading);
  const shown = useChasedProgress(progress);
  return (
    <div className={`hx-screen ld-screen ld-${mode}`}>
      <MenuBackdrop />
      <Stage>
        {mode === 'boot' ? <BootTitle /> : <Faceoff />}
        <ProgressBar value={shown} label={label} />
        {mode === 'match' && <Tip />}
      </Stage>
    </div>
  );
}

function BootTitle() {
  return (
    <div className="ld-boot-title">
      <div className="hx-logo big">LoLstone</div>
      <div className="hx-subtitle">峡 谷 战 局</div>
    </div>
  );
}

function Faceoff() {
  const { humanClass, aiClass, difficulty, humanDeck } = useUi((s) => s.menu);
  const online = useUi((s) => s.online?.match ?? null);
  const deckName = humanDeck ? getDeck(humanDeck)?.name : null;
  return (
    <div className="ld-faceoff">
      <Contender cls={online ? online.myClass : humanClass} side="left" caption={deckName ? `你 · ${deckName}` : '你'} />
      <div className="ld-vs">
        <span>VS</span>
      </div>
      {online ? (
        <Contender cls={online.opponentClass} side="right" caption={online.opponent} />
      ) : (
        <Contender cls={aiClass} side="right" caption={`对手 · ${difficultyName(difficulty)}`} />
      )}
    </div>
  );
}

function Contender({ cls, side, caption }: { cls: Parameters<typeof getHeroClass>[0]; side: 'left' | 'right'; caption: string }) {
  const def = getHeroClass(cls);
  const art = `url(${loadingArtUrl(def.champion)})`;
  return (
    <div className={`ld-contender ${side} region-${cls}`}>
      <div className="ld-aura" style={{ backgroundImage: art }} />
      <div className="ld-portrait">
        <div className="ld-portrait-art" style={{ backgroundImage: art }} />
      </div>
      <div className="ld-nameplate">
        <div className="ld-caption">{caption}</div>
        <div className="ld-hero">{CLASS_BLURBS[cls].hero}</div>
        <div className="ld-region">{def.name}</div>
      </div>
    </div>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="ld-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="ld-progress-text">
        <span>{label}</span>
        <span className="ld-pct">{pct}%</span>
      </div>
      <div className="ld-track">
        <div className="ld-fill" style={{ width: `${value * 100}%` }}>
          <span className="ld-spark" />
        </div>
      </div>
    </div>
  );
}

function Tip() {
  // 每次进加载页换一条，加载期间不变
  const tip = useMemo(randomTip, []);
  return (
    <div className="ld-tip">
      <span className="ld-tip-tag">小提示</span>
      <span>{tip}</span>
    </div>
  );
}
