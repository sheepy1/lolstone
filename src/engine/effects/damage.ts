import { getCard } from '../cardDb';
import { emit, findMinion, fxIdField, heroRef, type Ctx } from '../context';
import type { SourceRef } from '../events';
import { hasKeyword } from '../keywords';
import { getScript } from '../scripts';
import { other, type Fx, type MinionState, type TargetRef } from '../state';
import { updateEnrage } from './buff';
import { healCharacter } from './heal';

// 对一个角色造成伤害（spec 2.6）。返回实际造成的伤害（被圣盾挡下为 0）。
// sourceMinion 是造成伤害的随从（活着的或亡语时的快照），用来判断剧毒、吸血和消灭记功；
// 法术、英雄技能、疲劳传 null。
export function dealDamage(
  ctx: Ctx,
  group: number,
  source: SourceRef,
  sourceMinion: MinionState | null,
  target: TargetRef,
  amount: number,
  fx: Fx,
  fxId?: string,
): number {
  if (amount <= 0) return 0;
  let dealt = 0;
  if (target.kind === 'hero') {
    const hero = ctx.state.players[target.side].hero;
    const before = hero.health;
    hero.health -= amount;
    dealt = amount;
    emit(ctx, group, {
      kind: 'damage',
      source,
      target,
      amount,
      shieldAbsorbed: 0,
      healthBefore: before,
      healthAfter: hero.health,
      lethalPrevented: false,
      fx,
      ...fxIdField(fxId),
    });
  } else {
    const loc = findMinion(ctx.state, target.instanceId);
    if (!loc) return 0;
    const m = loc.minion;
    if (hasKeyword(m, 'divine_shield')) {
      m.keywords = m.keywords.filter((k) => k !== 'divine_shield');
      emit(ctx, group, {
        kind: 'damage',
        source,
        target,
        amount: 0,
        shieldAbsorbed: amount,
        healthBefore: m.health,
        healthAfter: m.health,
        lethalPrevented: false,
        fx,
        ...fxIdField(fxId),
      });
      emit(ctx, group, { kind: 'shield_broken', target });
      return 0;
    }
    const before = m.health;
    m.health -= amount;
    dealt = amount;
    const poisoned = sourceMinion !== null && hasKeyword(sourceMinion, 'poisonous');
    let lethalPrevented = false;
    // 剧毒命中必死，替代致命伤害的效果不用触发
    if (m.health <= 0 && before > 0 && !m.silenced && !poisoned && !m.pendingDestroy) {
      const def = getCard(m.cardId);
      const hook = getScript(def.script)?.onLethalDamage;
      if (hook && hook(m)) {
        lethalPrevented = true;
        emit(ctx, group, {
          kind: 'trigger',
          source: { kind: 'minion', side: loc.side, instanceId: m.instanceId, cardId: m.cardId },
          timing: 'script',
          target: null,
          script: def.script ?? null,
        });
      }
    }
    emit(ctx, group, {
      kind: 'damage',
      source,
      target,
      amount,
      shieldAbsorbed: 0,
      healthBefore: before,
      healthAfter: m.health,
      lethalPrevented,
      fx,
      ...fxIdField(fxId),
    });
    if (sourceMinion && source.kind === 'minion' && source.side === other(loc.side)) {
      ctx.kills = ctx.kills.filter((k) => k.victim !== m.instanceId);
      ctx.kills.push({ victim: m.instanceId, killer: sourceMinion.instanceId });
    }
    if (poisoned) m.pendingDestroy = true;
    updateEnrage(ctx, group, loc.side, m);
  }
  if (sourceMinion && hasKeyword(sourceMinion, 'lifesteal') && dealt > 0) {
    healCharacter(ctx, group, source, heroRef(source.side), dealt, 'holy');
  }
  return dealt;
}
