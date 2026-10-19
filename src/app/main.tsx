// 启动：装卡池、起 Pixi、挂 React 文字界面。地址带 ?replay 时回放夹具。
import { createRoot } from 'react-dom/client';
import { installDefaultPool } from '../cards';
import { UiRoot } from '../ui/UiRoot';
import '../ui/styles.css';
import { GameApp } from './game';
import { setUi } from './store';

installDefaultPool();
const app = new GameApp();
createRoot(document.getElementById('ui')!).render(<UiRoot app={app} />);

async function boot(): Promise<void> {
  setUi({ screen: 'boot', loading: { progress: 0.1, label: '初始化渲染器' } });
  await app.init(document.getElementById('stage')!);
  setUi({ loading: { progress: 1, label: '完成' } });
  const params = new URLSearchParams(location.search);
  if (params.has('replay')) {
    const { default: fixture } = await import('../../tests/fixtures/l0-replay.json');
    app.startReplay(fixture as unknown as Parameters<GameApp['startReplay']>[0]);
    return;
  }
  if (params.has('autoplay')) {
    await app.startMatch('demacia', 'freljord');
    app.autoplay(true);
    return;
  }
  setUi({ screen: 'menu' });
}

boot().catch((err) => {
  console.error(err);
  setUi({ error: `启动失败：${(err as Error).message}` });
});
