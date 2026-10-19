// 对局日志的文字（调试 AI 时拉出来看）。只靠遮过的事件写，对手的手牌照样看不到。
import { findCard, HIDDEN_CARD_ID, type GameEvent, type Side, type SourceRef, type TargetRef, type TriggerTiming } from '../engine';
import { KEYWORD_NAMES } from '../presentation/keywordText';

// 实例 id 到卡牌 id 的对照，随事件更新，离场的随从也能叫出名字。
export class LogNames {
  private names = new Map<number, string>();

  observe(e: GameEvent): void {
    const set = (id: number, cardId: string) => cardId !== HIDDEN_CARD_ID && this.names.set(id, cardId);
    switch (e.kind) {
      case 'mulligan_start':
        for (const h of e.hands) for (const c of h) set(c.instanceId, c.cardId);
        break;
      case 'mulligan_done':
        for (const c of e.drawn) set(c.instanceId, c.cardId);
        break;
      case 'draw':
      case 'card_played':
      case 'burn':
        set(e.card.instanceId, e.card.cardId);
        break;
      case 'minion_summoned':
        if (e.target.kind === 'minion') set(e.target.instanceId, e.cardId);
        break;
      case 'transform':
        if (e.newTarget.kind === 'minion') set(e.newTarget.instanceId, e.into);
        break;
      default:
        break;
    }
  }

  name(instanceId: number): string {
    const id = this.names.get(instanceId);
    return (id && findCard(id)?.name) || `#${instanceId}`;
  }
}

const cardName = (id: string) => findCard(id)?.name ?? id;

const TIMING: Record<TriggerTiming, string> = {
  battlecry: '战吼',
  deathrattle: '亡语',
  combo: '连击',
  turn_start: '回合开始效果',
  turn_end: '回合结束效果',
  on_kill: '击杀效果',
  script: '特效',
};

export function describe(e: GameEvent, names: LogNames, viewer: Side): string | null {
  const who = (s: Side) => (s === viewer ? '你' : '对手');
  const t = (r: TargetRef) => (r.kind === 'hero' ? `${who(r.side)}的英雄` : `${who(r.side)}的${names.name(r.instanceId)}`);
  const src = (s: SourceRef) => {
    switch (s.kind) {
      case 'minion':
        return `${who(s.side)}的${names.name(s.instanceId)}`;
      case 'spell':
      case 'hero_power':
        return `「${cardName(s.cardId)}」`;
      case 'hero':
        return `${who(s.side)}的英雄`;
      case 'fatigue':
        return '疲劳';
    }
  };
  switch (e.kind) {
    case 'mulligan_start':
      return `换牌阶段，${who(e.first)}先手`;
    case 'mulligan_done':
      return `${who(e.side)}换了 ${e.replaced.length} 张牌`;
    case 'game_start':
      return '对局开始';
    case 'turn_start':
      return `—— 第 ${e.turn} 回合：${who(e.side)}的回合 ——`;
    case 'turn_end':
      return `${who(e.side)}结束回合`;
    case 'draw':
      return e.card.cardId === HIDDEN_CARD_ID ? `${who(e.side)}抽了一张牌` : `${who(e.side)}抽到 ${cardName(e.card.cardId)}`;
    case 'burn':
      return `${who(e.side)}手牌已满，${cardName(e.card.cardId)} 被烧掉`;
    case 'fatigue':
      return `${who(e.side)}的牌库空了，疲劳 ${e.amount}`;
    case 'card_played':
      return `${who(e.side)}打出 ${cardName(e.card.cardId)}`;
    case 'minion_summoned':
      return e.via === 'play' ? null : `  召唤 ${cardName(e.cardId)}`;
    case 'spell_cast':
      return e.target ? `  目标：${t(e.target)}` : null;
    case 'hero_power_used':
      return `${who(e.side)}使用英雄技能「${cardName(e.cardId)}」${e.target ? `，目标 ${t(e.target)}` : ''}`;
    case 'trigger':
      return `  ${src(e.source)}触发${TIMING[e.timing]}${e.target ? `，目标 ${t(e.target)}` : ''}`;
    case 'attack':
      return `${t(e.attacker)} 攻击 ${t(e.target)}`;
    case 'damage':
      return e.shieldAbsorbed > 0
        ? `  ${t(e.target)} 的圣盾挡下 ${e.shieldAbsorbed} 点伤害`
        : `  ${t(e.target)} 受到 ${e.amount} 点伤害（${e.healthBefore} → ${e.healthAfter}）`;
    case 'heal':
      return `  ${t(e.target)} 恢复 ${e.amount} 点生命`;
    case 'death':
      return `  ${who(e.target.side)}的${cardName(e.cardId)} 死亡`;
    case 'buff': {
      const parts: string[] = [];
      if (e.attack || e.health) parts.push(`${e.attack >= 0 ? '+' : ''}${e.attack}/${e.health >= 0 ? '+' : ''}${e.health}`);
      if (e.keywords.length) parts.push(`获得${e.keywords.map((k) => KEYWORD_NAMES[k]).join('、')}`);
      if (e.keywordsLost.length) parts.push(`失去${e.keywordsLost.map((k) => KEYWORD_NAMES[k]).join('、')}`);
      return `  ${t(e.target)} ${parts.join('，')}${e.reason === 'expire' ? '（到期）' : e.reason === 'enrage' ? '（激怒）' : ''}`;
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
      return `  ${cardName(e.cardId)} 变形为 ${cardName(e.into)}`;
    case 'mana_changed':
      return null;
    case 'game_over':
      return e.winner === 'draw' ? '平局' : `${who(e.winner)}获胜`;
  }
}
