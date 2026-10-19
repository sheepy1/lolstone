// 招牌卡专属特效的调试场景（docs/m4-signature-fx.md）：每张卡搭一个能触发它的真实局面，动作交给引擎执行，
// 事件是引擎真发出来的（fxId、分组、顺序都和对局里一样），所以调试台上看到的就是对局里会看到的。
// 调试台（/dev/fx 的"招牌卡"面板）和测试（tests/presentation-signature.test.ts）共用。只依赖引擎，不碰 DOM。
import { getCard, type Action, type GameState, type MinionState, type Side } from '../engine';

export type SignatureCard = { fxId: string; name: string; trigger: string };

export const SIGNATURE_CARDS: readonly SignatureCard[] = [
  { fxId: 'yasuo.last_breath', name: '狂风绝息斩', trigger: '法术' },
  { fxId: 'anivia.glacial_storm', name: '暴风雪', trigger: '法术' },
  { fxId: 'lissandra.frozen_tomb', name: '丽桑卓', trigger: '战吼' },
  { fxId: 'katarina.death_lotus', name: '卡特琳娜', trigger: '战吼' },
  { fxId: 'garen.judgment', name: '审判', trigger: '法术' },
  { fxId: 'garen.demacian_justice', name: '德玛西亚正义', trigger: '法术' },
  { fxId: 'tryndamere.undying_rage', name: '泰达米尔', trigger: '受到致命伤害' },
  { fxId: 'masteryi.highlander', name: '易', trigger: '击杀' },
  { fxId: 'zed.living_shadow', name: '劫', trigger: '战吼召唤' },
  { fxId: 'leesin.dragons_rage', name: '李青', trigger: '连击回手' },
  { fxId: 'baron.hand_of_baron', name: '纳什男爵', trigger: '回合结束' },
];

// 敌方随从：头像各不相同的英雄随从，生命各不相同（群体伤害打死一部分、留下一部分）
const FOES: { id: string; health: number }[] = [
  { id: 'noxus.swain', health: 5 },
  { id: 'noxus.draven', health: 2 },
  { id: 'noxus.vladimir', health: 4 },
  { id: 'neutral.chogath', health: 7 },
  { id: 'noxus.annie', health: 1 },
  { id: 'noxus.samira', health: 3 },
  { id: 'neutral.gromp', health: 3 },
];
const FRIENDS = ['ionia.irelia', 'ionia.shen', 'ionia.akali', 'ionia.karma', 'ionia.kennen', 'ionia.yone'];

export type SignatureSetup = { state: GameState; actions: Action[] };

// fxId 对应的局面和要执行的动作。base 是任意一个对局中的局面（取它的牌库、职业、回合数），foes 是敌方随从数
export function signatureScenario(fxId: string, base: GameState, foes = 3): SignatureSetup {
  const s = structuredClone(base) as GameState;
  s.phase = 'playing';
  s.current = 0;
  const me = s.players[0];
  const opp = s.players[1];
  me.mana = { max: 10, current: 10, temp: 0 };
  me.hand = [];
  me.board = [];
  me.cardsPlayedThisTurn = 0;
  me.heroPowerUsed = false;
  opp.board = [];
  me.mulliganDone = opp.mulliganDone = true;
  const n = Math.max(1, Math.min(7, foes));
  const minion = (side: Side, id: string, o: Partial<MinionState> = {}): MinionState => {
    const def = getCard(id);
    const maxHealth = o.maxHealth ?? o.health ?? def.health ?? 1;
    const m: MinionState = {
      instanceId: s.nextInstanceId++,
      cardId: id,
      attack: def.attack ?? 0,
      health: maxHealth,
      maxHealth,
      buffs: [],
      keywords: [...(def.keywords ?? [])],
      attacksThisTurn: 0,
      enteredTurn: s.turn - 1,
      silenced: false,
      summonOrder: s.nextSummonOrder++,
      extraAttacks: 0,
      ...o,
    };
    s.players[side].board.push(m);
    return m;
  };
  const card = (id: string) => {
    me.hand.push({ instanceId: s.nextInstanceId++, cardId: id });
    return me.hand.length - 1;
  };
  const foesOf = (count: number, o: (i: number) => Partial<MinionState> = () => ({})) =>
    FOES.slice(0, count).map((f, i) => minion(1, f.id, { health: f.health, maxHealth: Math.max(f.health, getCard(f.id).health ?? 1), ...o(i) }));
  const enemyRef = (m: MinionState) => ({ side: 1 as Side, kind: 'minion' as const, instanceId: m.instanceId });
  const friends = (count: number) => FRIENDS.slice(0, count).map((id) => minion(0, id));
  const play = (id: string, extra: Partial<Extract<Action, { kind: 'play_card' }>> = {}): Action => ({ kind: 'play_card', handIndex: card(id), ...extra });

  switch (fxId) {
    case 'yasuo.last_breath':
      foesOf(n);
      return { state: s, actions: [play('ionia.last_breath')] };
    case 'anivia.glacial_storm':
      foesOf(n);
      return { state: s, actions: [play('freljord.blizzard')] };
    case 'garen.judgment':
      foesOf(n);
      return { state: s, actions: [play('demacia.judgment')] };
    case 'garen.demacian_justice': {
      const list = foesOf(n);
      return { state: s, actions: [play('demacia.demacian_justice', { target: enemyRef(list[Math.min(1, list.length - 1)]!) })] };
    }
    case 'lissandra.frozen_tomb':
      friends(2);
      foesOf(n);
      return { state: s, actions: [play('freljord.lissandra', { position: 1 })] };
    case 'katarina.death_lotus':
      friends(2);
      foesOf(n);
      return { state: s, actions: [play('noxus.katarina', { position: 1 })] };
    case 'zed.living_shadow':
      friends(2);
      foesOf(n);
      return { state: s, actions: [play('ionia.zed', { position: 1 })] };
    case 'leesin.dragons_rage': {
      friends(2);
      const list = foesOf(n);
      me.cardsPlayedThisTurn = 1; // 连击：本回合已经出过一张牌
      return { state: s, actions: [play('ionia.leesin', { position: 1, target: enemyRef(list[Math.min(1, list.length - 1)]!) })] };
    }
    case 'baron.hand_of_baron':
      minion(0, 'ionia.irelia');
      minion(0, 'neutral.baron_nashor');
      minion(0, 'ionia.shen');
      minion(0, 'ionia.akali');
      foesOf(n);
      return { state: s, actions: [{ kind: 'end_turn' }] };
    case 'tryndamere.undying_rage': {
      minion(0, 'ionia.irelia');
      const tr = minion(0, 'freljord.tryndamere');
      minion(0, 'ionia.shen');
      const list = foesOf(n, (i) => (i === Math.min(1, n - 1) ? { attack: 9 } : {}));
      const big = list[Math.min(1, list.length - 1)]!;
      return { state: s, actions: [{ kind: 'attack', attacker: { side: 0, kind: 'minion', instanceId: tr.instanceId }, target: enemyRef(big) }] };
    }
    case 'masteryi.highlander': {
      friends(1);
      const yi = minion(0, 'ionia.masteryi');
      const list = foesOf(n, (i) => (i === Math.min(1, n - 1) ? { health: 2, maxHealth: 2, attack: 1 } : {}));
      const prey = list[Math.min(1, list.length - 1)]!;
      return { state: s, actions: [{ kind: 'attack', attacker: { side: 0, kind: 'minion', instanceId: yi.instanceId }, target: enemyRef(prey) }] };
    }
  }
  throw new Error(`没有这个招牌特效的调试场景：${fxId}`);
}
