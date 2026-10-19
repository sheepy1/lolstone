// React 文字界面的根，叠在 Three.js 画布上面一层（spec 6.1）：加载页、主菜单、换牌页、结算页、悬停卡面、日志，
// 以及叠在页面上的对局菜单和设置页。
// 换页时上一页不立刻消失：在新页上面淡出 0.45 秒（m4-first-minutes 第 1 步：加载完不能直接切到主菜单）。
import { useEffect, useState, type ReactNode } from 'react';
import type { GameApp } from '../app/game';
import { useUi, type Screen } from '../app/store';
import { GameLog } from './GameLog';
import { HoverCardPanel } from './HoverCard';
import { LoadingScreen } from './LoadingScreen';
import { DeckScreen } from './DeckScreen';
import { MainMenu } from './MainMenu';
import { MulliganOverlay } from './MulliganOverlay';
import { PauseMenu, useEscOpensPauseMenu } from './PauseMenu';
import { ResultPanel } from './ResultPanel';
import { SettingsPanel } from './SettingsPanel';
import { StatusBar } from './StatusBar';

const LEAVE_MS = 450;

// 当前页，加上正在淡出的上一页（对局页销毁时场景已经没了，不留）。
// 上一页先原样盖着，等新页真正画出一帧（两次 requestAnimationFrame）再开始淡出：进对局时建场景会卡住主线程
// 几百毫秒，而透明度动画在合成线程上照样走，不等的话卡顿期间就淡完了，看起来还是硬切。
function useScreenLayers(screen: Screen): { current: Screen; leaving: Screen | null; fading: boolean } {
  const [shown, setShown] = useState(screen);
  const [leaving, setLeaving] = useState<Screen | null>(null);
  const [fading, setFading] = useState(false);
  // 换页在渲染时就记下上一页（而不是等 effect），这样上一页在任何一次提交里都不会被卸载
  if (shown !== screen) {
    setShown(screen);
    setLeaving(shown === 'match' ? null : shown);
    setFading(false);
  }
  useEffect(() => {
    if (!leaving) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        setFading(true);
        timer = setTimeout(() => setLeaving(null), LEAVE_MS);
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [leaving]);
  return { current: screen, leaving: leaving === screen ? null : leaving, fading };
}

export function UiRoot({ app }: { app: GameApp }) {
  const screen = useUi((s) => s.screen);
  const error = useUi((s) => s.error);
  const panels = useUi((s) => s.panels);
  const { current, leaving, fading } = useScreenLayers(screen);
  useEscOpensPauseMenu(app);
  const render = (s: Screen): ReactNode => {
    if (s === 'boot') return <LoadingScreen mode="boot" />;
    if (s === 'loading') return <LoadingScreen mode="match" />;
    if (s === 'menu') return <MainMenu app={app} />;
    if (s === 'decks') return <DeckScreen app={app} />;
    return (
      <>
        <HoverCardPanel />
        <MulliganOverlay app={app} />
        <ResultPanel app={app} />
        <StatusBar app={app} />
        <GameLog />
      </>
    );
  };
  // 两层都带 key，新页总是插在后面：一页从"当前"变成"淡出"时还是同一个 DOM 节点、不挪位置
  // （挪动节点会让 CSS 入场动画从头再放），淡出层靠 z-index 盖在新页上面
  const layers = leaving ? [leaving, current] : [current];
  return (
    <>
      {layers.map((s) => (
        <div key={s} className={`hx-layer ${s === leaving ? `leaving ${fading ? 'fading' : ''}` : ''}`}>
          {render(s)}
        </div>
      ))}
      {screen === 'match' && panels.includes('pause') && <PauseMenu app={app} />}
      {panels[panels.length - 1] === 'settings' && <SettingsPanel app={app} />}
      {error && <div className="error-toast">{error}</div>}
    </>
  );
}
