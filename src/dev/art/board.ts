// /dev/art?view=board：用对局的舞台、镜头、灯光和泛光摆一个固定的中盘局面，检查 1080p 下的实际观感：
// 场上随从带各种关键词图标（嘲讽、潜行、剧毒、吸血、风怒、冲锋、突袭、法术伤害、沉默），手牌里放卡池里正文最长的几张，
// 左侧悬停大卡显示纳什男爵。?inspect=<卡牌 id> 换悬停大卡（?inspect=none 不显示）。saveBoard() 存到 .dev-output/<名>.png（画布原尺寸）。
// 局面可以操作（假的宿主：合法动作按这个局面手写，攻击会真的播攻击动画），用来检查目标箭头：随从能攻击对方随从和英雄
// （潜行的提莫不能选），手牌里有指向友方的铁誓、指向随从的灵魄突袭、冻结的魔法水晶箭。
// 自动化录帧：window.boardDev 给出 stage、gsap、世界坐标换页面坐标的 screenOf、按卡牌 id 找实例的 idOf。
import gsap from 'gsap';
import { installDefaultPool } from '../../cards';
import { Director } from '../../presentation/director';
import { createGsapPlayer } from '../../presentation/player';
import { Interaction } from '../../scene/interaction';
import type { Action, TargetRef } from '../../engine';
import * as THREE from 'three';
import { loadManifest } from '../../assets/loader';
import { matchManifest } from '../../assets/manifest';
import { getCard, type Keyword } from '../../engine';
import type { ViewMinion, ViewPlayer, ViewState } from '../../presentation/viewState';
import { preloadCardFont } from '../../scene/cardText';
import { Stage } from '../../scene/stage';
import { TableScene } from '../../scene/table';

installDefaultPool();

let id = 100;
const minion = (cardId: string, keywords: Keyword[] = [], extra: Partial<ViewMinion> = {}): ViewMinion => {
  const d = getCard(cardId);
  return { instanceId: id++, cardId, attack: d.attack ?? 0, health: d.health ?? 0, maxHealth: d.health ?? 0, keywords, frozen: false, silenced: false, ...extra };
};
const player = (heroClass: ViewPlayer['heroClass'], hand: string[], board: ViewMinion[]): ViewPlayer => ({
  heroClass,
  hero: { health: 24, maxHealth: 30 },
  mana: { max: 7, current: 7, temp: 0 },
  deckCount: 14,
  hand: hand.map((cardId) => ({ instanceId: id++, cardId })),
  board,
  fatigue: 0,
  heroPowerUsed: false,
  mulliganDone: true,
});

const view: ViewState = {
  viewer: 0,
  phase: 'playing',
  turn: 13,
  current: 0,
  winner: null,
  players: [
    player(
      'freljord',
      ['freljord.tryndamere', 'demacia.iron_oath', 'ionia.spirit_rush', 'freljord.crystal_arrow', 'neutral.baron_nashor', 'freljord.udyr', 'freljord.blizzard'],
      [
        minion('neutral.ancient_krug', ['taunt']),
        minion('neutral.gromp', ['poisonous', 'lifesteal']),
        minion('freljord.udyr', ['windfury', 'charge', 'rush']),
        minion('neutral.velkoz'),
        minion('neutral.khazix', ['stealth']),
        minion('neutral.siege_minion', ['rush'], { silenced: true }),
      ],
    ),
    player('noxus', ['hidden', 'hidden', 'hidden', 'hidden'], [
      minion('neutral.baron_nashor'),
      minion('neutral.teemo', ['stealth', 'poisonous']),
      minion('noxus.draven'),
    ]),
  ],
};

const params = new URLSearchParams(location.search);
const decks = view.players.map((p) => [...p.hand, ...p.board].map((c) => c.cardId).filter((c) => c !== 'hidden'));
await loadManifest(matchManifest(decks, ['freljord', 'noxus']), () => {});
await preloadCardFont(decks.flat().map((c) => getCard(c).name + getCard(c).text).join('') + '0123456789+-/');
const stage = new Stage(document.getElementById('stage')!);
const scene = new TableScene(view, stage);
const inspect = params.get('inspect') ?? 'neutral.baron_nashor';
if (inspect !== 'none') scene.showInspect(inspect, null);

// 假的宿主：合法动作按这个局面手写
const ref = (side: 0 | 1, instanceId: number): TargetRef => ({ side, kind: 'minion', instanceId });
const [me, foe] = view.players;
const visibleFoes = foe.board.filter((m) => !m.keywords.includes('stealth'));
const legal: Action[] = [{ kind: 'end_turn' }];
for (const m of me.board) {
  for (const f of visibleFoes) legal.push({ kind: 'attack', attacker: ref(0, m.instanceId), target: ref(1, f.instanceId) });
  legal.push({ kind: 'attack', attacker: ref(0, m.instanceId), target: { side: 1, kind: 'hero' } });
}
me.hand.forEach((c, handIndex) => {
  const targets: TargetRef[] =
    c.cardId === 'demacia.iron_oath'
      ? me.board.map((m) => ref(0, m.instanceId))
      : c.cardId === 'ionia.spirit_rush'
        ? [...me.board.map((m) => ref(0, m.instanceId)), ...visibleFoes.map((m) => ref(1, m.instanceId))]
        : c.cardId === 'freljord.crystal_arrow'
          ? [...me.board.map((m) => ref(0, m.instanceId)), ...visibleFoes.map((m) => ref(1, m.instanceId)), { side: 1, kind: 'hero' }, { side: 0, kind: 'hero' }]
          : [];
  for (const target of targets) legal.push({ kind: 'play_card', handIndex, target });
});
const gsapPlayer = createGsapPlayer(scene);
const director = new Director(view, gsapPlayer.play);
const submitted: Action[] = [];
const healthOf = (t: TargetRef) => (t.kind === 'hero' ? view.players[t.side].hero.health : view.players[t.side].board.find((m) => m.instanceId === t.instanceId)!.health);
const interaction = new Interaction(scene, {
  legal: () => (director.busy ? null : legal),
  submit: (a) => {
    submitted.push(a);
    if (a.kind !== 'attack' || a.attacker.kind !== 'minion') return;
    const atk = me.board.find((m) => m.instanceId === (a.attacker as { instanceId: number }).instanceId)!;
    const before = healthOf(a.target);
    director.enqueue([
      { kind: 'attack', group: 1, attacker: a.attacker, target: a.target },
      { kind: 'damage', group: 1, source: { kind: 'minion', side: 0, instanceId: atk.instanceId, cardId: atk.cardId }, target: a.target, amount: atk.attack, shieldAbsorbed: 0, healthBefore: before, healthAfter: Math.max(1, before - atk.attack), lethalPrevented: false, fx: 'physical' },
    ]);
  },
  busy: () => director.busy,
  fastForward: () => {},
  hover: () => {},
  mulliganChanged: () => {},
  waiting: () => false,
});
director.subscribe(() => interaction.refresh());
interaction.refresh();

const idOf = (side: 0 | 1, cardId: string, where: 'board' | 'hand' = 'board') => view.players[side][where].find((m) => m.cardId === cardId)!.instanceId;
const screenOf = (x: number, y: number, z: number) => {
  const p = new THREE.Vector3(x, y, z).project(stage.camera);
  const r = stage.canvas.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
};
(window as unknown as { boardDev: unknown }).boardDev = { stage, scene, gsap, director, submitted, idOf, screenOf };
(window as unknown as { boardReady: boolean }).boardReady = true;
(window as unknown as { saveBoard: (name?: string) => Promise<string> }).saveBoard = async (name = 'art-board') => {
  await new Promise((r) => setTimeout(r, 300));
  stage.frame();
  const url = stage.canvas.toDataURL('image/png');
  const r = await fetch(`/__dev/screenshot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
  return r.text();
};
