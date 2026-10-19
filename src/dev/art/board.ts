// /dev/art?view=board：用对局的舞台、镜头、灯光和泛光摆一个固定的中盘局面，检查 1080p 下的实际观感：
// 场上随从带各种关键词图标（嘲讽、潜行、剧毒、吸血、风怒、冲锋、突袭、法术伤害、沉默），手牌里放卡池里正文最长的几张，
// 左侧悬停大卡显示纳什男爵。?inspect=<卡牌 id> 换悬停大卡。"保存"存到 .dev-output/art-board.png（画布原尺寸）。
import { installDefaultPool } from '../../cards';
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
      ['freljord.tryndamere', 'freljord.udyr', 'neutral.baron_nashor', 'demacia.sona', 'ionia.leesin', 'freljord.trundle', 'freljord.blizzard'],
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
      minion('neutral.baron_nashor', ['taunt']),
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
scene.showInspect(params.get('inspect') ?? 'neutral.baron_nashor', null);
(window as unknown as { boardReady: boolean }).boardReady = true;
(window as unknown as { saveBoard: (name?: string) => Promise<string> }).saveBoard = async (name = 'art-board') => {
  await new Promise((r) => setTimeout(r, 300));
  stage.frame();
  const url = stage.canvas.toDataURL('image/png');
  const r = await fetch(`/__dev/screenshot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
  return r.text();
};
