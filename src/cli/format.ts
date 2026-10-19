// 命令行对局的文字输出：局面、合法动作、事件日志。
import type { Action } from '../engine/actions';
import { getCard, getHeroClass } from '../engine/cardDb';
import type { GameEvent, SourceRef } from '../engine/events';
import { canAttack } from '../engine/keywords';
import { HIDDEN_CARD_ID, type GameState, type Keyword, type MinionState, type Side, type TargetRef } from '../engine/state';

const KEYWORD_NAMES: Record<Keyword, string> = {
  taunt: '嘲讽',
  charge: '冲锋',
  rush: '突袭',
  divine_shield: '圣盾',
  stealth: '潜行',
  windfury: '风怒',
  lifesteal: '吸血',
  poisonous: '剧毒',
};

const SIDE_NAMES = ['玩家0', '玩家1'];

// 实例 id 到卡牌 id 的对照，随着局面和事件更新，日志里离场的随从也能叫出名字。
export class NameBook {
  private names = new Map<number, string>();

  observe(state: GameState): void {
    for (const p of state.players) {
      for (const c of [...p.deck, ...p.hand]) if (c.cardId !== HIDDEN_CARD_ID) this.names.set(c.instanceId, c.cardId);
      for (const m of p.board) this.names.set(m.instanceId, m.cardId);
    }
  }

  observeEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.kind === 'minion_summoned' && e.target.kind === 'minion') this.names.set(e.target.instanceId, e.cardId);
      if (e.kind === 'transform' && e.newTarget.kind === 'minion') this.names.set(e.newTarget.instanceId, e.into);
    }
  }

  name(instanceId: number): string {
    const id = this.names.get(instanceId);
    return id ? getCard(id).name : `#${instanceId}`;
  }
}

export function sideName(side: Side, viewer?: Side): string {
  if (viewer === undefined) return SIDE_NAMES[side];
  return side === viewer ? '你' : '对手';
}

function minionLine(state: GameState, m: MinionState, index: number, mine: boolean): string {
  const def = getCard(m.cardId);
  const kws = m.keywords.map((k) => KEYWORD_NAMES[k]);
  const notes: string[] = [];
  if (m.frozenAt !== undefined) notes.push('冻结');
  if (m.silenced) notes.push('沉默');
  if (mine && state.current !== undefined && canAttack(state, m)) notes.push('可攻击');
  const extra = [...kws, ...notes].join(' ');
  const hp = m.health < m.maxHealth ? `${m.health}/${m.maxHealth}` : `${m.health}`;
  return `  [${index}] ${def.name} ${m.attack}/${hp}${extra ? `  (${extra})` : ''}`;
}

export function formatState(state: GameState, viewer: Side): string {
  const lines: string[] = [];
  const enemy: Side = viewer === 0 ? 1 : 0;
  const show = (side: Side) => {
    const p = state.players[side];
    const cls = getHeroClass(p.heroClass);
    const temp = p.mana.temp > 0 ? `（含临时 ${p.mana.temp}）` : '';
    lines.push(
      `${sideName(side, viewer)}：${cls.name}·${cls.champion}  生命 ${p.hero.health}/${p.hero.maxHealth}  ` +
        `法力 ${p.mana.current}/${p.mana.max}${temp}  手牌 ${p.hand.length}  牌库 ${p.deck.length}` +
        (p.fatigue > 0 ? `  疲劳 ${p.fatigue}` : '') +
        (p.heroPowerUsed ? '  技能已用' : ''),
    );
    if (p.board.length === 0) lines.push('  （场上没有随从）');
    p.board.forEach((m, i) => lines.push(minionLine(state, m, i, side === viewer && state.current === viewer)));
  };
  lines.push(`—— 第 ${state.turn} 回合，${sideName(state.current, viewer)}行动 ——`);
  show(enemy);
  lines.push('  ～～～～～～ 河道 ～～～～～～');
  show(viewer);
  const hand = state.players[viewer].hand.map((c, i) => {
    const d = getCard(c.cardId);
    const stats = d.type === 'minion' ? ` ${d.attack}/${d.health}` : '';
    return `  (${i}) ${d.name} [${d.cost}费${stats}] ${d.text}`;
  });
  lines.push('你的手牌：', ...(hand.length ? hand : ['  （空）']));
  return lines.join('\n');
}

export function targetName(state: GameState, book: NameBook, ref: TargetRef, viewer?: Side): string {
  if (ref.kind === 'hero') return `${sideName(ref.side, viewer)}的英雄`;
  return `${sideName(ref.side, viewer)}的${book.name(ref.instanceId)}`;
}

export function describeAction(state: GameState, book: NameBook, action: Action, viewer?: Side): string {
  switch (action.kind) {
    case 'mulligan': {
      if (action.replace.length === 0) return '换牌：一张都不换';
      const hand = state.players[action.player].hand;
      return `换牌：换掉 ${action.replace.map((i) => getCard(hand[i].cardId).name).join('、')}`;
    }
    case 'play_card': {
      const card = state.players[state.current].hand[action.handIndex];
      const def = getCard(card.cardId);
      let s = `打出 ${def.name}`;
      if (action.position !== undefined) s += ` 到位置 ${action.position}`;
      if (action.target) s += `，目标 ${targetName(state, book, action.target, viewer)}`;
      return s;
    }
    case 'attack':
      return `${targetName(state, book, action.attacker, viewer)} 攻击 ${targetName(state, book, action.target, viewer)}`;
    case 'hero_power': {
      const def = getCard(getHeroClass(state.players[state.current].heroClass).heroPower);
      return `英雄技能「${def.name}」${action.target ? `，目标 ${targetName(state, book, action.target, viewer)}` : ''}`;
    }
    case 'end_turn':
      return '结束回合';
  }
}

function sourceName(book: NameBook, s: SourceRef | null, viewer?: Side): string {
  if (!s) return '';
  switch (s.kind) {
    case 'minion':
      return `${sideName(s.side, viewer)}的${book.name(s.instanceId)}`;
    case 'spell':
    case 'hero_power':
      return `「${getCard(s.cardId).name}」`;
    case 'hero':
      return `${sideName(s.side, viewer)}的英雄`;
    case 'fatigue':
      return '疲劳';
  }
}

// 把一个事件写成一行日志。返回 null 的事件不打印（法力变化太啰嗦）。
export function describeEvent(state: GameState, book: NameBook, e: GameEvent, viewer?: Side): string | null {
  const t = (ref: TargetRef) => targetName(state, book, ref, viewer);
  const who = (side: Side) => sideName(side, viewer);
  const cardName = (id: string) => getCard(id).name;
  const hiddenFor = (side: Side) => viewer !== undefined && side !== viewer;
  switch (e.kind) {
    case 'mulligan_start':
      return `进入换牌阶段，${who(e.first)}先手`;
    case 'mulligan_done':
      return `${who(e.side)}换了 ${e.replaced.length} 张牌`;
    case 'game_start':
      return '对局开始';
    case 'turn_start':
      return `== 第 ${e.turn} 回合：${who(e.side)}的回合 ==`;
    case 'turn_end':
      return `${who(e.side)}结束回合`;
    case 'draw':
      return hiddenFor(e.side) ? `${who(e.side)}抽了一张牌` : `${who(e.side)}抽到 ${cardName(e.card.cardId)}`;
    case 'burn':
      return `${who(e.side)}手牌已满，${cardName(e.card.cardId)} 被烧掉`;
    case 'fatigue':
      return `${who(e.side)}的牌库空了，疲劳 ${e.amount}`;
    case 'card_played':
      return `${who(e.side)}打出 ${cardName(e.card.cardId)}`;
    case 'minion_summoned':
      return e.via === 'play' ? null : `${who(e.side)}召唤了 ${cardName(e.cardId)}`;
    case 'spell_cast':
      return e.target ? `  目标：${t(e.target)}` : null;
    case 'hero_power_used':
      return `${who(e.side)}使用英雄技能「${cardName(e.cardId)}」${e.target ? `，目标 ${t(e.target)}` : ''}`;
    case 'trigger': {
      const label: Record<string, string> = {
        battlecry: '战吼',
        deathrattle: '亡语',
        combo: '连击',
        turn_start: '回合开始',
        turn_end: '回合结束',
        on_kill: '消灭',
        script: '特效',
      };
      return `  ${sourceName(book, e.source, viewer)}触发${label[e.timing]}${e.target ? `，目标 ${t(e.target)}` : ''}`;
    }
    case 'attack':
      return `${t(e.attacker)} 攻击 ${t(e.target)}`;
    case 'damage':
      if (e.shieldAbsorbed > 0) return `  ${t(e.target)} 的圣盾挡下了 ${e.shieldAbsorbed} 点伤害`;
      return `  ${t(e.target)} 受到 ${e.amount} 点伤害（${e.healthBefore} → ${e.healthAfter}）${e.lethalPrevented ? '，但没有倒下' : ''}`;
    case 'heal':
      return `  ${t(e.target)} 恢复 ${e.amount} 点生命（${e.healthBefore} → ${e.healthAfter}）`;
    case 'death':
      return `  ${who(e.target.side)}的${cardName(e.cardId)} 死亡`;
    case 'buff': {
      const parts: string[] = [];
      if (e.attack !== 0 || e.health !== 0) parts.push(`${e.attack >= 0 ? '+' : ''}${e.attack}/${e.health >= 0 ? '+' : ''}${e.health}`);
      if (e.keywords.length) parts.push(`获得${e.keywords.map((k) => KEYWORD_NAMES[k]).join('、')}`);
      if (e.keywordsLost.length) parts.push(`失去${e.keywordsLost.map((k) => KEYWORD_NAMES[k]).join('、')}`);
      const why = e.reason === 'expire' ? '（本回合增益到期）' : e.reason === 'enrage' ? '（激怒）' : '';
      return `  ${t(e.target)} ${parts.join('，')}${why}`;
    }
    case 'silence':
      return `  ${t(e.target)} 被沉默`;
    case 'freeze':
      return `  ${t(e.target)} 被冻结`;
    case 'unfreeze':
      return `  ${t(e.target)} 解冻`;
    case 'shield_broken':
      return `  ${t(e.target)} 失去圣盾`;
    case 'stealth_lost':
      return `  ${t(e.target)} 失去潜行`;
    case 'bounce':
      return e.destroyed ? `  ${t(e.target)} 回手时手牌已满，被销毁` : `  ${t(e.target)} 回到手牌`;
    case 'transform':
      return `  ${who(e.target.side)}的${cardName(e.cardId)} 变形为 ${cardName(e.into)}`;
    case 'mana_changed':
      return e.reason === 'gain_mana' ? `  ${who(e.side)}的法力 ${e.before.current}/${e.before.max} → ${e.after.current}/${e.after.max}` : null;
    case 'game_over':
      return e.winner === 'draw' ? '*** 平局 ***' : `*** ${who(e.winner)}获胜 ***`;
  }
}
