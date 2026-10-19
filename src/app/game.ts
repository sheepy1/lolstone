// 对局控制：把对局层、导演、场景、输入、界面状态接起来。一局一套，回主菜单时整套销毁。
import gsap from 'gsap';
import { matchManifest } from '../assets/manifest';
import { loadManifest } from '../assets/loader';
import { initAudio, playMusic, playSfx, stopAmbience } from '../audio';
import { PRESET_DECKS } from '../cards';
import { getCard, getHeroClass, maskEvents, maskHidden, seedRng, type Action, type HeroClass, type Side } from '../engine';
import { Director } from '../presentation/director';
import type { PresentationEvent } from '../presentation/events';
import { createGsapPlayer, type GsapPlayer } from '../presentation/player';
import type { ViewState } from '../presentation/viewState';
import type { ReplayFixture } from '../presentation/fixture';
import { Interaction, type HoverInfo } from '../scene/interaction';
import { KeywordHover } from '../scene/keywordHover';
import { preloadCardFont } from '../scene/cardText';
import { Stage } from '../scene/stage';
import { TableScene } from '../scene/table';
import { KEYWORD_NAMES } from '../presentation/keywordText';
import { describe, LogNames } from '../ui/logText';
import type { Difficulty } from '../ui/menuData';
import { getSettings, onSettingsChange } from '../ui/settings';
import { deckForMatch, isPreset } from '../ui/decks';
import { l0ChooseAction } from '../ai/l0';
import { l2Async } from '../ai/l2Worker';
import { warmCardFaces } from '../presentation/fx/warm';
import { Match } from './match';
import { getUi, setUi, type Panel } from './store';

const LOG_LIMIT = 400;
// 对局加载页的最短停留时间（毫秒）
const MIN_LOADING_MS = 1400;

function waitUntil(t: number): Promise<void> {
  const ms = t - performance.now();
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

type Session = {
  scene: TableScene;
  director: Director;
  player: GsapPlayer;
  interaction: Interaction;
  keywordHover: KeywordHover;
  match: Match | null; // 回放时为 null
  unsubscribe: () => void;
};

export class GameApp {
  private stage: Stage | null = null;
  private session: Session | null = null;
  private names = new LogNames();
  // 调试用的自动驾驶：玩家这一方也随机选合法动作，走和界面相同的 submit 路径，快进播放
  private autoplayOn = false;
  private autoRng = seedRng(20261019);
  // 指针下的关键词图标（KEYWORD_HELP 的词条名），不在图标上时为 null
  private hoverKeyword: string | null = null;

  async init(host: HTMLElement): Promise<void> {
    this.stage = new Stage(host);
    setUi((s) => ({ status: { ...s.status, renderer: this.stage!.rendererName } }));
    // 调试入口：在控制台看显示局面、对局状态
    (window as unknown as { melol: unknown }).melol = this;
    onSettingsChange(() => this.applyBaseSpeed());
  }

  // ---------- 面板、暂停、动画速度 ----------

  // 打开一个面板（对局菜单或设置）。对局中有面板打开时游戏暂停。
  openPanel(panel: Panel): void {
    setUi((s) => ({ panels: [...s.panels.filter((p) => p !== panel), panel] }));
    this.syncPause();
  }

  // 关掉最上面的面板；all 为 true 时全部关掉。面板都关掉后游戏继续。
  closePanel(all = false): void {
    setUi((s) => ({ panels: all ? [] : s.panels.slice(0, -1) }));
    this.syncPause();
  }

  get paused(): boolean {
    return gsap.globalTimeline.paused();
  }

  // 暂停就是停住 GSAP 的全局时间线：对局里所有动画（包括 AI 思考的等待）都在上面，导演等当前这一步播完才放下一步，
  // AI 的动作在队列里排着，所以动画停住，AI 也不再行动。输入由盖在画布上的面板挡住。
  private syncPause(): void {
    const ui = getUi();
    gsap.globalTimeline.paused(!!this.session && ui.screen === 'match' && ui.panels.length > 0);
  }

  // 设置里的动画速度：导演有事件在播时全局时间线按这个倍数走，空闲时回到 1 倍（河面、按钮脉动这些环境循环不跟着变快）。
  // 快进时播放器把时间线设成三倍，不受这个设置影响；播完 resetSpeed 回到 1 倍，下一次有事件时这里再按设置调。
  private applyBaseSpeed(): void {
    const s = this.session;
    if (s && s.player.speed === 1) gsap.globalTimeline.timeScale(s.director.busy ? getSettings().animSpeed : 1);
  }

  // 认输：对局菜单里确认后调用。暂停解除，排着的动画快进播完，然后播失败演出。
  concede(): void {
    const s = this.session;
    if (!s?.match || s.match.over) return;
    this.closePanel(true);
    s.match.concede();
    if (s.director.busy) s.player.fastForward();
    this.onDirector();
  }

  get current(): Session | null {
    return this.session;
  }

  // 手动渲染一帧（页面不可见、requestAnimationFrame 停了的时候，自动化验证用）
  renderFrame(): void {
    this.stage?.frame();
  }

  // 开发环境：渲染一帧，把画布原尺寸存成 PNG（开发服务器写到 .dev-output/<name>.png），返回文件路径
  async saveScreenshot(name: string): Promise<string> {
    if (!import.meta.env.DEV || !this.stage) throw new Error('只在开发环境可用');
    this.stage.frame();
    const url = this.stage.canvas.toDataURL('image/png');
    const r = await fetch(`/__dev/screenshot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return r.text();
  }

  // 应用自己用的 GSAP 实例。自动化验证时页面不可见，要手动推进它的时钟（gsap.ticker.tick()）。
  get gsap(): typeof gsap {
    return gsap;
  }

  // 开一局：先在加载页预载两套卡组的美术和语音，再进对局。
  // seed 不给时随机；给了就能复现同一局（调试、自动化验证用，自动驾驶的随机数也从头开始）。
  // difficulty 是 AI 难度（spec 4.1）：l0 随机，l1 贪心，l2 回合内搜索。humanDeck 是我方的自组卡组 id，null 或不能用时用预组。
  async startMatch(humanClass: HeroClass, aiClass: HeroClass, seed?: number, difficulty: Difficulty = 'l1', humanDeck: string | null = null): Promise<void> {
    initAudio();
    this.teardown();
    const loadStart = performance.now();
    // 我方可以用自组卡组（不存在或不合规时退回预组），对手用预组
    const mine = deckForMatch(humanClass, humanDeck);
    const decks: [string[], string[]] = [[...mine.cards], [...(PRESET_DECKS[aiClass] ?? [])]];
    setUi((s) => ({
      screen: 'loading',
      loading: { progress: 0, label: '载入英雄美术和语音' },
      menu: { ...s.menu, humanClass, aiClass, difficulty, humanDeck: isPreset(mine.id) ? null : mine.id },
      result: null,
      log: [],
      error: null,
    }));
    // 进度条：美术和语音占前 90%，卡面字体占最后 10%
    const report = await loadManifest(matchManifest(decks, [humanClass, aiClass]), (p) =>
      setUi((s) => ({ loading: { ...s.loading, progress: p * 0.9 } })),
    );
    // 卡面 SDF 字体和本局两套卡组用到的字，开局时不用临时排版
    setUi((s) => ({ loading: { ...s.loading, label: '载入卡面字体' } }));
    const chars = [...decks[0], ...decks[1]].map((id) => getCard(id)).map((d) => d.name + d.text).join('') + '0123456789';
    await preloadCardFont(chars);
    // 两套卡组的卡面和随从头像先画好、传到显卡，第一次抽到、第一次上场时不用现画（fx/warm.ts）
    if (this.stage) warmCardFaces(this.stage.renderer, [...decks[0], ...decks[1]]);
    setUi((s) => ({ loading: { ...s.loading, progress: 1, label: '准备就绪' } }));
    // 资源已在缓存里时加载只要几十毫秒，加载页至少停留一小段，双方英雄对峙的画面和进度条走完都看得见
    await waitUntil(loadStart + MIN_LOADING_MS);
    if (report.missing.length > 0) console.info(`[assets] ${report.missing.length} 个资源缺失，用纯色兜底`, report.missing.slice(0, 5));
    const matchSeed = seed ?? Math.floor(Math.random() * 1_000_000);
    if (seed !== undefined) this.autoRng = seedRng(seed);
    console.info(`[match] seed ${matchSeed}`);
    // l0 随机、l1 贪心（同步，主线程）、l2 回合内搜索（Web Worker）
    const ai = difficulty === 'l0' ? l0ChooseAction : undefined;
    const aiAsync = difficulty === 'l2' ? l2Async() : undefined;
    const match = new Match({ seed: matchSeed, classes: [humanClass, aiClass], decks, human: 0, ai, aiAsync });
    this.names = new LogNames();
    match.onBatch = (events) => this.log(events, 0);
    this.open(match.initial, match);
    match.start(this.session!.director);
  }

  // 回放夹具：观战视角，不接受输入。
  startReplay(fixture: ReplayFixture): void {
    this.teardown();
    this.names = new LogNames();
    setUi({ screen: 'match', result: null, log: [], error: null, status: { ...getUi().status, replay: true } });
    this.open(fixture.initialView, null);
    const director = this.session!.director;
    fixture.batches.forEach((b, i) => {
      if (i > 0 && b.actor !== null) director.enqueue([{ kind: 'ai_thinking', group: 0, side: b.actor, seconds: 0.25 }]);
      const masked = maskEvents(b.events, fixture.viewer);
      this.log(masked, fixture.viewer);
      director.enqueue(masked);
    });
  }

  private open(initial: ViewState, match: Match | null): void {
    const scene = new TableScene(initial, this.stage!);
    const player = createGsapPlayer(scene);
    const director = new Director(initial, player.play);
    const interaction = new Interaction(scene, {
      legal: () => match?.legalActions() ?? null,
      submit: (a) => this.submit(a),
      busy: () => director.busy,
      fastForward: () => {
        player.fastForward();
        setUi((s) => ({ status: { ...s.status, speed: player.speed } }));
      },
      hover: (h) => this.onHover(h),
      mulliganChanged: (marked) => setUi({ mulligan: { open: getUi().mulligan.open, marked: marked.size } }),
      waiting: () => !!match && !match.over && !match.humanToAct(),
    });
    // 悬停在随从的关键词图标上：关键词面板里把那一条排到最前、高亮
    const keywordHover = new KeywordHover(scene, (k) => {
      this.hoverKeyword = k;
      setUi((s) => (s.hover ? { hover: { ...s.hover, keyword: k } } : {}));
    });
    const unsubscribe = director.subscribe(() => this.onDirector());
    this.session = { scene, director, player, interaction, keywordHover, match, unsubscribe };
    setUi({ screen: 'match' });
    // 进对局换成对局音乐，再叠上峡谷环境音（两层可以同时放）
    playMusic('match');
    playMusic('ambience');
    this.onDirector();
  }

  private teardown(): void {
    const s = this.session;
    if (!s) return;
    s.match?.stop();
    s.unsubscribe();
    s.interaction.destroy();
    s.keywordHover.destroy();
    s.player.resetSpeed();
    gsap.globalTimeline.paused(false);
    // 先停掉这一局的全部动画：GSAP 里只有对局场景的动画。留着的循环动画（河面反光、按钮脉动）会去改
    // 已经销毁的 Pixi 对象，在 GSAP 的帧回调里抛错，下一局的动画就全部停住
    for (const anim of gsap.globalTimeline.getChildren(false, true, true)) anim.kill();
    s.scene.dispose();
    this.session = null;
    setUi({ hover: null, panels: [], mulligan: { open: false, marked: 0 }, status: { ...getUi().status, replay: false, busy: false } });
  }

  backToMenu(): void {
    this.teardown();
    // 菜单页会自己换成菜单音乐，环境音只属于对局，这里停掉
    stopAmbience();
    setUi({ screen: 'menu', result: null });
  }

  submit(action: Action): void {
    const s = this.session;
    if (!s?.match) return;
    const err = s.match.submit(action);
    if (err) console.warn('[input] action rejected', action, err);
    this.onDirector();
  }

  confirmMulligan(): void {
    const s = this.session;
    if (!s?.match) return;
    const view = s.director.displayed;
    const hand = view.players[view.viewer].hand;
    const replace = hand.map((c, i) => (s.scene.mulliganMarks.has(c.instanceId) ? i : -1)).filter((i) => i >= 0);
    s.scene.mulliganMarks.clear();
    playSfx('ui.button');
    setUi({ mulligan: { open: false, marked: 0 } });
    this.submit({ kind: 'mulligan', player: view.viewer, replace });
  }

  // 打开或关闭自动驾驶（控制台 melol.autoplay()，或地址带 ?autoplay）。
  autoplay(on = true): void {
    this.autoplayOn = on;
    this.onDirector();
  }

  private autoStep(): void {
    const s = this.session;
    if (!this.autoplayOn || !s?.match) return;
    const legal = s.match.legalActions();
    if (!legal) return;
    const choice = l0ChooseAction(maskHidden(s.match.state, s.match.human), s.match.human, this.autoRng);
    if (!choice) return;
    this.autoRng = choice.rng;
    if (choice.action.kind === 'mulligan') setUi({ mulligan: { open: false, marked: 0 } });
    this.submit(choice.action);
  }

  private onDirector(): void {
    const s = this.session;
    if (!s) return;
    const { director, match, player, scene } = s;
    const view = director.displayed;
    this.applyBaseSpeed();
    if (this.autoplayOn) {
      if (director.busy && player.speed === 1) player.fastForward();
      if (!director.busy && match?.humanToAct()) setTimeout(() => this.autoStep(), 30);
    }
    if (!director.busy) {
      player.resetSpeed();
      scene.draggingHand = null;
      scene.boardGap = null;
      if (director.errors.length > 0) setUi({ error: `动画出错 ${director.errors.length} 次，见控制台` });
    }
    s.interaction.refresh();
    const mulliganOpen = !!match && !director.busy && view.phase === 'mulligan' && match.humanToAct();
    const ui = getUi();
    const status = { busy: director.busy, myTurn: !!match && match.humanToAct(), speed: player.speed, renderer: ui.status.renderer, replay: !match };
    const patch: Partial<typeof ui> = {};
    if (JSON.stringify(status) !== JSON.stringify(ui.status)) patch.status = status;
    if (mulliganOpen !== ui.mulligan.open) patch.mulligan = { open: mulliganOpen, marked: scene.mulliganMarks.size };
    if (view.phase === 'over' && !director.busy && !ui.result && view.winner !== null) {
      const winner = view.winner;
      patch.result = { winner, won: winner === view.viewer, turns: view.turn };
    }
    if (Object.keys(patch).length > 0) setUi(patch);
  }

  // 悬停：场上随从和英雄技能在场景左侧放大显示（场景里的卡牌网格）；手牌本身会抬起放大，不另外显示。
  // 关键词解释走 DOM，贴在放大卡下面（手牌悬停时贴在画面左侧）。
  private onHover(h: HoverInfo | null): void {
    const s = this.session;
    const card = this.hoverCard(h);
    if (s) s.scene.showInspect(card && h?.kind !== 'hand' ? card.cardId : null, card?.stats ?? null);
    const anchor = s?.scene.inspectAnchor() ?? null;
    setUi({ hover: card ? { ...card, anchor, keyword: h?.kind === 'minion' ? this.hoverKeyword : null } : null });
  }

  private hoverCard(h: HoverInfo | null) {
    const s = this.session;
    if (!h || !s) return null;
    const view = s.scene.view;
    if (h.kind === 'hand') {
      const c = view.players[view.viewer].hand.find((x) => x.instanceId === h.instanceId);
      return c ? { cardId: c.cardId } : null;
    }
    if (h.kind === 'hero_power') return { cardId: getHeroClass(view.players[h.side].heroClass).heroPower };
    const m = view.players[h.side].board.find((x) => x.instanceId === h.instanceId);
    if (!m) return null;
    return {
      cardId: m.cardId,
      stats: {
        attack: m.attack,
        health: m.health,
        maxHealth: m.maxHealth,
        keywords: m.keywords.map((k) => KEYWORD_NAMES[k]),
        frozen: m.frozen,
        silenced: m.silenced,
      },
    };
  }

  private log(events: readonly PresentationEvent[], viewer: Side): void {
    const lines: string[] = [];
    for (const e of events) {
      if (e.kind === 'ai_thinking') continue;
      this.names.observe(e);
      const line = describe(e, this.names, viewer);
      if (line) lines.push(line);
    }
    if (lines.length > 0) setUi((s) => ({ log: [...s.log, ...lines].slice(-LOG_LIMIT) }));
  }
}
