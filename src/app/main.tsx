// 启动：装卡池、等界面字体、挂 React 文字界面。地址带 ?replay 时回放夹具。
// 渲染器和对局控制不在首包里（shell.ts）：主菜单显示后在后台加载；回放和自动驾驶直接进对局，启动时就加载。
// 联机入口（shell.loadOnline）：地址带 ?online=fake 接开发用的假平台；没有参数时探一下这个 host 后面有没有托管平台，有才显示入口。
// 有联机（真的或假的）时 ?autoplay 是联机自动驾驶：自动建房或进房、我方自动出牌，一局接一局；没有就是单机自动驾驶。
import { createRoot } from 'react-dom/client';
import { loadManifest } from '../assets/loader';
import { loadingArtUrl, type AssetEntry } from '../assets/manifest';
import { installDefaultPool } from '../cards';
import { allHeroClasses } from '../engine';
import { UiRoot } from '../ui/UiRoot';
import '../ui/styles.css';
import '../ui/fontFaces.css';
import '../ui/menu.css';
import '../ui/overlay.css';
import '../ui/deck.css';
import '../ui/cursors.css';
import '../ui/online.css';
import { MENU_FONT } from '../ui/hextech';
import { getSettings } from '../ui/settings';
import type { GameApp } from './game';
import type { OnlineClient } from './online';
import { AppShell } from './shell';
import { setUi } from './store';

installDefaultPool();
// 主菜单的 AI 难度从设置里的默认值开始
setUi((s) => ({ menu: { ...s.menu, difficulty: getSettings().difficulty } }));
const app = new AppShell(document.getElementById('stage')!);
createRoot(document.getElementById('ui')!).render(<UiRoot app={app} />);

// 打开页面的加载页最短停留时间（毫秒）：进度条走完、游戏名看得清，再淡入主菜单
const MIN_BOOT_MS = 900;

// 主菜单要等的只有界面字体里主菜单上的字那一片（src/ui/fontFaces.css；字形不对第一眼就不对）。index.html 里 preload 了它，
// JS 下载时就在一起下，到这里通常已经下了一大半。document.fonts.load 默认按空格挑字体，空格在这一片里，只等这一片。
// 字体加载没有字节进度，进度条按时间从 from 往 90% 逼近，到齐后走满。
async function preloadMenu(from: number): Promise<void> {
  const label = '载入字体';
  setUi({ loading: { progress: from, label } });
  const t0 = performance.now();
  const creep = setInterval(() => {
    const k = 1 - Math.exp(-(performance.now() - t0) / 1500);
    setUi({ loading: { progress: from + k * (0.9 - from), label } });
  }, 100);
  await (document.fonts?.load(`700 32px "${MENU_FONT}"`).catch(() => []) ?? Promise.resolve([]));
  clearInterval(creep);
  setUi({ loading: { progress: 1, label: '准备就绪' } });
}

// 界面字体的其余部分（主菜单上没有的字）：浏览器本来要到页面上出现这些字时才下载，到时会先用系统字体再换过来；
// 主菜单出来后先在后台下好，设置、卡组页、对局里的文字一出来就是对的字体。
function loadRestOfUiFont(): Promise<unknown> {
  const faces: FontFace[] = [];
  document.fonts?.forEach((f) => {
    if (f.family.replace(/["']/g, '') === MENU_FONT && f.status === 'unloaded') faces.push(f);
  });
  return Promise.all(faces.map((f) => f.load().catch(() => null)));
}

// 主菜单四张职业卡的竖版原画，后台加载，主菜单不等它：慢网络上卡先用同色调的底出来，到了再淡入（MainMenu 的 useArtLoaded）。
// 快网络上加载页的最短停留期间就到了，主菜单第一帧就有原画，和以前一样。
function loadMenuArt(): Promise<unknown> {
  const entries: AssetEntry[] = allHeroClasses().map((c) => ({ kind: 'loading', key: c.champion, url: loadingArtUrl(c.champion) }));
  return loadManifest(entries, () => {});
}

async function boot(): Promise<void> {
  const t0 = performance.now();
  const params = new URLSearchParams(location.search);
  const loadOnline = () => app.loadOnline(params).catch((err: unknown) => (console.error('[online]', err), null));
  // 联机的流程和平台接口在后台载。地址点名了平台（?online）就马上载；没点名时要先探一下有没有平台，探测放在主菜单要等的
  // 字体到齐之后，不和它分带宽
  let onlineReady: Promise<OnlineClient | null> | null = params.has('online') ? loadOnline() : null;
  // 回放和自动驾驶不经过主菜单，渲染器在加载页上就起好：渲染器 0 到 30%，字体 30% 到 90%；直接进对局，界面字体整份都等
  let game: GameApp | null = null;
  let menuArt: Promise<unknown> | null = null;
  if (params.has('replay') || params.has('autoplay')) {
    setUi({ screen: 'boot', loading: { progress: 0.05, label: '初始化渲染器' } });
    if (params.has('autoplay')) onlineReady ??= loadOnline();
    game = await app.load();
    await Promise.all([preloadMenu(0.3), loadRestOfUiFont()]);
  } else {
    setUi({ screen: 'boot', loading: { progress: 0.05, label: '载入字体' } });
    await preloadMenu(0.05);
    onlineReady ??= loadOnline();
    // 字体到齐再下原画：一起下会分带宽，主菜单就要晚出来
    menuArt = loadMenuArt();
  }
  const wait = t0 + MIN_BOOT_MS - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (game && params.has('replay')) {
    const { default: fixture } = await import('../../tests/fixtures/l0-replay.json');
    game.startReplay(fixture as unknown as Parameters<GameApp['startReplay']>[0]);
    return;
  }
  if (game) {
    // 自动驾驶：有联机（真平台或假平台）就联机打，没有就单机打
    const client = await onlineReady;
    if (client) {
      setUi({ screen: 'menu' });
      client.startAutoplay();
      return;
    }
    await game.startMatch('demacia', 'freljord');
    game.autoplay(true);
    return;
  }
  setUi({ screen: 'menu' });
  // 后台按先后下：原画（主菜单上看得见）、其余的界面字体、对局代码，一个接一个，不互相分带宽。
  // 没等到就点了开局，开局自己会加载要用的
  void menuArt
    ?.then(loadRestOfUiFont)
    .then(() => app.prefetch());
}

boot().catch((err) => {
  console.error(err);
  setUi({ error: `启动失败：${(err as Error).message}` });
});
