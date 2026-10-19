// React 文字界面的根，叠在 Pixi 画布上面一层（spec 6.1）：加载页、主菜单、换牌页、结算页、悬停卡面、日志。
import type { GameApp } from '../app/game';
import { useUi } from '../app/store';
import { GameLog } from './GameLog';
import { HoverCardPanel } from './HoverCard';
import { LoadingScreen } from './LoadingScreen';
import { MainMenu } from './MainMenu';
import { MulliganOverlay } from './MulliganOverlay';
import { ResultPanel } from './ResultPanel';
import { StatusBar } from './StatusBar';

export function UiRoot({ app }: { app: GameApp }) {
  const screen = useUi((s) => s.screen);
  const error = useUi((s) => s.error);
  return (
    <>
      {(screen === 'boot' || screen === 'loading') && <LoadingScreen />}
      {screen === 'menu' && <MainMenu app={app} />}
      {screen === 'match' && (
        <>
          <HoverCardPanel />
          <MulliganOverlay app={app} />
          <ResultPanel app={app} />
          <StatusBar app={app} />
          <GameLog />
        </>
      )}
      {error && <div className="error-toast">{error}</div>}
    </>
  );
}
