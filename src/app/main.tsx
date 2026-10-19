// 启动：装卡池、起渲染器、预载主菜单素材、挂 React 文字界面。地址带 ?replay 时回放夹具。
import { createRoot } from 'react-dom/client';
import { loadManifest } from '../assets/loader';
import { loadingArtUrl, type AssetEntry } from '../assets/manifest';
import { installDefaultPool } from '../cards';
import { allHeroClasses } from '../engine';
import { UiRoot } from '../ui/UiRoot';
import '../ui/styles.css';
import '../ui/menu.css';
import '../ui/overlay.css';
import '../ui/cursors.css';
import { MENU_FONT } from '../ui/hextech';
import { getSettings } from '../ui/settings';
import { GameApp } from './game';
import { setUi } from './store';

installDefaultPool();
// 主菜单的 AI 难度从设置里的默认值开始
setUi((s) => ({ menu: { ...s.menu, difficulty: getSettings().difficulty } }));
const app = new GameApp();
createRoot(document.getElementById('ui')!).render(<UiRoot app={app} />);

// 打开页面的加载页最短停留时间（毫秒）：进度条走完、游戏名看得清，再淡入主菜单
const MIN_BOOT_MS = 900;

// 主菜单要用的四张职业原画和界面字体。进度条按真实加载走：渲染器 0 到 30%，原画和字体 30% 到 100%。
async function preloadMenu(): Promise<void> {
  const entries: AssetEntry[] = allHeroClasses().map((c) => ({ kind: 'loading', key: c.champion, url: loadingArtUrl(c.champion) }));
  const fonts = document.fonts?.load(`700 32px "${MENU_FONT}"`).catch(() => []) ?? Promise.resolve([]);
  await Promise.all([loadManifest(entries, (p) => setUi({ loading: { progress: 0.3 + p * 0.6, label: '载入职业原画' } })), fonts]);
  setUi({ loading: { progress: 1, label: '准备就绪' } });
}

async function boot(): Promise<void> {
  const t0 = performance.now();
  setUi({ screen: 'boot', loading: { progress: 0.05, label: '初始化渲染器' } });
  await app.init(document.getElementById('stage')!);
  setUi({ loading: { progress: 0.3, label: '载入职业原画' } });
  await preloadMenu();
  const wait = t0 + MIN_BOOT_MS - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
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
