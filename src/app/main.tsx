// 启动：装卡池、预载主菜单素材、挂 React 文字界面。地址带 ?replay 时回放夹具。
// 渲染器和对局控制不在首包里（shell.ts）：主菜单显示后在后台加载；回放和自动驾驶直接进对局，启动时就加载。
// 地址带 ?online=fake 时主菜单有联机入口，接开发用的假平台；再带 ?autoplay 时自动建房、我方自动出牌，一局接一局。
import { createRoot } from 'react-dom/client';
import { loadManifest } from '../assets/loader';
import { loadingArtUrl, type AssetEntry } from '../assets/manifest';
import { installDefaultPool } from '../cards';
import { allHeroClasses } from '../engine';
import { UiRoot } from '../ui/UiRoot';
import '../ui/styles.css';
import '../ui/menu.css';
import '../ui/overlay.css';
import '../ui/deck.css';
import '../ui/cursors.css';
import '../ui/online.css';
import { MENU_FONT } from '../ui/hextech';
import { getSettings } from '../ui/settings';
import type { GameApp } from './game';
import { AppShell } from './shell';
import { setUi } from './store';

installDefaultPool();
// 主菜单的 AI 难度从设置里的默认值开始
setUi((s) => ({ menu: { ...s.menu, difficulty: getSettings().difficulty } }));
const app = new AppShell(document.getElementById('stage')!);
createRoot(document.getElementById('ui')!).render(<UiRoot app={app} />);

// 打开页面的加载页最短停留时间（毫秒）：进度条走完、游戏名看得清，再淡入主菜单
const MIN_BOOT_MS = 900;

// 主菜单要用的四张职业原画和界面字体。进度条按真实加载走：原画和字体从 from 走到 90%，最后 10% 是收尾。
async function preloadMenu(from: number): Promise<void> {
  const entries: AssetEntry[] = allHeroClasses().map((c) => ({ kind: 'loading', key: c.champion, url: loadingArtUrl(c.champion) }));
  const fonts = document.fonts?.load(`700 32px "${MENU_FONT}"`).catch(() => []) ?? Promise.resolve([]);
  await Promise.all([loadManifest(entries, (p) => setUi({ loading: { progress: from + p * (0.9 - from), label: '载入职业原画' } })), fonts]);
  setUi({ loading: { progress: 1, label: '准备就绪' } });
}

async function boot(): Promise<void> {
  const t0 = performance.now();
  const params = new URLSearchParams(location.search);
  const online = params.has('online');
  // 联机的流程和平台接口在后台载，和主菜单素材同时进行
  const onlineReady = online ? app.loadOnline(params).catch((err: unknown) => (console.error('[online]', err), null)) : Promise.resolve(null);
  // 回放和自动驾驶不经过主菜单，渲染器在加载页上就起好：渲染器 0 到 30%，原画和字体 30% 到 90%
  let game: GameApp | null = null;
  if (params.has('replay') || params.has('autoplay')) {
    setUi({ screen: 'boot', loading: { progress: 0.05, label: '初始化渲染器' } });
    game = await app.load();
    setUi({ loading: { progress: 0.3, label: '载入职业原画' } });
    await preloadMenu(0.3);
  } else {
    setUi({ screen: 'boot', loading: { progress: 0.05, label: '载入职业原画' } });
    await preloadMenu(0.05);
  }
  const wait = t0 + MIN_BOOT_MS - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (game && params.has('replay')) {
    const { default: fixture } = await import('../../tests/fixtures/l0-replay.json');
    game.startReplay(fixture as unknown as Parameters<GameApp['startReplay']>[0]);
    return;
  }
  if (game && online) {
    setUi({ screen: 'menu' });
    (await onlineReady)?.startAutoplay();
    return;
  }
  if (game) {
    await game.startMatch('demacia', 'freljord');
    game.autoplay(true);
    return;
  }
  setUi({ screen: 'menu' });
  app.prefetch();
}

boot().catch((err) => {
  console.error(err);
  setUi({ error: `启动失败：${(err as Error).message}` });
});
