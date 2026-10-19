import { emit, type Ctx } from '../context';
import { MAX_MANA, type Side } from '../state';
import { drawCard } from './draw';

// 获得法力水晶（spec 2.8）。
// temp：本回合可用的临时水晶，current 和 temp 同加，current 不超过 10，回合结束时清掉。
// empty：永久提高上限但不回复法力；上限已经是 10 时，每个空水晶改为抽一张牌。
export function gainMana(ctx: Ctx, group: number, side: Side, mode: 'empty' | 'temp', amount: number): void {
  const mana = ctx.state.players[side].mana;
  const before = { ...mana };
  let draws = 0;
  if (mode === 'temp') {
    const gained = Math.max(0, Math.min(amount, MAX_MANA - mana.current));
    mana.current += gained;
    mana.temp += gained;
  } else {
    for (let i = 0; i < amount; i++) {
      if (mana.max < MAX_MANA) mana.max += 1;
      else draws += 1;
    }
  }
  emit(ctx, group, { kind: 'mana_changed', side, before, after: { ...mana }, reason: 'gain_mana' });
  for (let i = 0; i < draws; i++) drawCard(ctx, group, side);
}
