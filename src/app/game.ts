// 对局控制：把对局层、导演、场景、输入、界面状态接起来。一局一套，回主菜单时整套销毁。
import gsap from 'gsap';
import { matchManifest } from '../assets/manifest';
import { loadManifest } from '../assets/loader';
import { initAudio } from '../audio';
import { PRESET_DECKS } from '../cards';
import { getCard, getHeroClass, maskEvents, maskHidden, seedRng, type Action, type HeroClass, type Side } from '../engine';
import { Director } from '../presentation/director';
import type { PresentationEvent } from '../presentation/events';
import { createGsapPlayer, type GsapPlayer } from '../presentation/player';
import type { ViewState } from '../presentation/viewState';
import type { ReplayFixture } from '../presentation/fixture';
import { Interaction, type HoverInfo } from '../scene/interaction';
import { preloadCardFont } from '../scene/cardText';
import { Stage } from '../scene/stage';
import { TableScene } from '../scene/table';
import { KEYWORD_NAMES } from '../presentation/keywordText';
import { describe, LogNames } from '../ui/logText';
import { l0ChooseAction } from '../ai/l0';
import { Match } from './match';
import { getUi, setUi } from './store';

const LOG_LIMIT = 400;

type Session = {
  scene: TableScene;
  director: Director;
  player: GsapPlayer;
  interaction: Interaction;
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

  async init(host: HTMLElement): Promise<void> {
    this.stage = new Stage(host);
    setUi((s) => ({ status: { ...s.status, renderer: this.stage!.rendererName } }));
    // 调试入口：在控制台看显示局面、对局状态
    (window as unknown as { melol: unknown }).melol = this;
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
  async startMatch(humanClass: HeroClass, aiClass: HeroClass, seed?: number): Promise<void> {
    initAudio();
    this.teardown();
    const decks: [string[], string[]] = [[...(PRESET_DECKS[humanClass] ?? [])], [...(PRESET_DECKS[aiClass] ?? [])]];
    setUi({ screen: 'loading', loading: { progress: 0, label: '载入英雄美术和语音' }, result: null, log: [], error: null });
    const report = await loadManifest(matchManifest(decks, [humanClass, aiClass]), (p) =>
      setUi((s) => ({ loading: { ...s.loading, progress: p } })),
    );
    // 卡面 SDF 字体和本局两套卡组用到的字，开局时不用临时排版
    setUi((s) => ({ loading: { ...s.loading, label: '载入卡面字体' } }));
    const chars = [...decks[0], ...decks[1]].map((id) => getCard(id)).map((d) => d.name + d.text).join('') + '0123456789';
    await preloadCardFont(chars);
    if (report.missing.length > 0) console.info(`[assets] ${report.missing.length} 个资源缺失，用纯色兜底`, report.missing.slice(0, 5));
    const matchSeed = seed ?? Math.floor(Math.random() * 1_000_000);
    if (seed !== undefined) this.autoRng = seedRng(seed);
    console.info(`[match] seed ${matchSeed}`);
    const match = new Match({ seed: matchSeed, classes: [humanClass, aiClass], decks, human: 0 });
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
    const unsubscribe = director.subscribe(() => this.onDirector());
    this.session = { scene, director, player, interaction, match, unsubscribe };
    setUi({ screen: 'match' });
    this.onDirector();
  }

  private teardown(): void {
    const s = this.session;
    if (!s) return;
    s.unsubscribe();
    s.interaction.destroy();
    s.player.resetSpeed();
    // 先停掉这一局的全部动画：GSAP 里只有对局场景的动画。留着的循环动画（河面反光、按钮脉动）会去改
    // 已经销毁的 Pixi 对象，在 GSAP 的帧回调里抛错，下一局的动画就全部停住
    for (const anim of gsap.globalTimeline.getChildren(false, true, true)) anim.kill();
    s.scene.dispose();
    this.session = null;
    setUi({ hover: null, mulligan: { open: false, marked: 0 }, status: { ...getUi().status, replay: false, busy: false } });
  }

  backToMenu(): void {
    this.teardown();
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
    if (this.autoplayOn) {
      if (director.busy && player.speed === 1) player.fastForward();
      if (!director.busy && match?.humanToAct()) setTimeout(() => this.autoStep(), 30);
    }
    if (!director.busy) {
      player.resetSpeed();
      scene.draggingHand = null;
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
    setUi({ hover: card ? { ...card, anchor } : null });
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
