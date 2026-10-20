// 应用外壳：文字界面拿到的 app。主菜单只需要它和 React 界面，对局控制（GameApp：Three.js 舞台、导演、动画、特效）
// 在单独的 chunk 里，首屏不下载。主菜单显示后在后台加载并起好舞台（prefetch），平时点开局时已经就绪，和拆分前一样；
// 还没加载完就点了开局，加载页先出来，这一局的美术和它同时下载，都到了再开局。回放和自动驾驶在启动时直接 load。
// 联机的流程（online.ts）和平台接口也按需加载：地址里有联机参数时才载，没有时主菜单不显示联机入口。
import { loadManifest } from '../assets/loader';
import { matchManifest } from '../assets/manifest';
import type { HeroClass } from '../engine';
import { matchDecks } from '../ui/decks';
import type { Difficulty } from '../ui/menuData';
import type { GameApp } from './game';
import type { OnlineClient } from './online';
import { getUi, popPanel, pushPanel, setUi, type Panel } from './store';

export class AppShell {
  private game: GameApp | null = null;
  private loading: Promise<GameApp> | null = null;
  private online: OnlineClient | null = null;

  constructor(private readonly host: HTMLElement) {}

  // 加载对局控制的 chunk、起渲染器。重复调用拿到同一个；加载失败后下次调用重试。
  load(): Promise<GameApp> {
    this.loading ??= import('./game')
      .then(async ({ GameApp }) => {
        const game = new GameApp();
        await game.init(this.host);
        this.game = game;
        return game;
      })
      .catch((err: unknown) => {
        this.loading = null;
        throw err;
      });
    return this.loading;
  }

  // 主菜单显示后调用：等浏览器空闲时在后台加载，不和主菜单的入场动画抢主线程。失败了不报，开局时再试一次。
  prefetch(): void {
    const run = () => void this.load().catch((err: unknown) => console.warn('[app] 预载对局场景失败，开局时再载一次', err));
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 200);
  }

  // 载入联机的流程，接上平台，问有没有没打完的局。没有可用的平台时返回 null（主菜单不显示联机入口）
  async loadOnline(params: URLSearchParams): Promise<OnlineClient | null> {
    const { OnlineClient, initialOnlineUi, openLink } = await import('./online');
    const link = await openLink(params);
    if (!link) return null;
    this.online = new OnlineClient(this, link);
    setUi({ online: initialOnlineUi() });
    await this.online.init();
    return this.online;
  }

  // 主菜单联机面板、等待页、结算面板用的联机操作。只有 loadOnline 成功后界面上才有这些入口
  get onlineClient(): OnlineClient | null {
    return this.online;
  }

  async startMatch(humanClass: HeroClass, aiClass: HeroClass, seed?: number, difficulty?: Difficulty, humanDeck?: string | null): Promise<void> {
    setUi((s) => (s.online ? { online: { ...s.online, match: null } } : {}));
    if (!this.game) {
      // 对局控制还没加载完：加载页先出来，这一局的美术和它同时下载（加载器按地址去重，GameApp.startMatch 接着用），
      // 不等它下载完才开始，进度条按美术走，和 GameApp.startMatch 的前 90% 一致
      setUi({ screen: 'loading', loading: { progress: 0, label: '载入英雄美术' }, error: null });
      const { decks } = matchDecks(humanClass, aiClass, humanDeck ?? null);
      void loadManifest(matchManifest(decks, [humanClass, aiClass]), (p) => {
        if (!this.game) setUi((s) => ({ loading: { ...s.loading, progress: p * 0.9 } }));
      });
    }
    let game: GameApp;
    try {
      game = await this.load();
    } catch (err) {
      console.error(err);
      setUi({ screen: 'menu', error: `载入对局场景失败：${(err as Error).message}` });
      return;
    }
    await game.startMatch(humanClass, aiClass, seed, difficulty, humanDeck);
  }

  // 面板在主菜单（设置）和对局里（对局菜单、设置）都能开；对局控制加载了就交给它，顺带处理暂停
  openPanel(panel: Panel): void {
    if (this.game) this.game.openPanel(panel);
    else pushPanel(panel);
  }

  closePanel(all = false): void {
    if (this.game) this.game.closePanel(all);
    else popPanel(all);
  }

  // 下面这些只在对局里用得到，那时对局控制一定已经加载
  concede(): void {
    this.game?.concede();
  }

  // 联机对局里回主菜单等于认输（online.md 3.4）
  backToMenu(): void {
    if (this.online?.inMatch && getUi().online?.match) this.online.leaveMatch();
    else this.game?.backToMenu();
  }

  confirmMulligan(): void {
    this.game?.confirmMulligan();
  }

  endTurnAnchor(): { x: number; y: number; width: number } | null {
    return this.game?.endTurnAnchor() ?? null;
  }
}
