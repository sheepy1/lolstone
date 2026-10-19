// 英雄技能（m4-storyboard E23，600ms，中档）：按下 200（图标缩到 0.92 再弹回、顶面亮一下）、出手 300（按职业，
// 见 fx/heroPowerFx.ts）、冷却 100（灰色遮罩从下往上盖住图标）。
// 声音：ui 按下 t=0；职业专属音在出手 t=0；impact 交给命中帧接上的事件（伤害、冻结、召唤）。镜头：断头台命中 S1，其余 S0。
// 命中帧：德玛西亚是光柱落地，其余是飞行物到达；报的 tail 让导演在命中帧开始下一组（召唤、伤害、冻结）。
import { playSfx } from '../../audio';
import { other } from '../../engine';
import { boardSlot } from '../layout';
import { cooldownWipe, heroPowerCast, pressHeroPower } from '../fx/heroPowerFx';
import { addOrSpill } from '../fx/spellFx';
import { HERO_POWER, heroPowerDuration, heroPowerHit, stepEnd, tailFor } from '../fx/spellPlan';
import { panAt } from './combat';
import type { AnimModule } from './types';
import { tl } from './util';

export const heroPowerUsed: AnimModule<'hero_power_used'> = (e, { scene, before, after }) => {
  const t = tl();
  const cls = after.players[e.side].heroClass;
  const view = scene.heroPowers[e.side];
  const from = () => scene.heroPowerPoint(e.side);
  const press = HERO_POWER.pressDown + HERO_POWER.pressUp;
  const pan = panAt(from().x);
  // 德玛西亚的士兵落在最右边：召唤之后这一排有 n + 1 个，它在第 n 个
  const n = before.players[e.side].board.length;
  const summonAt = () => boardSlot(scene.place(e.side), n, n + 1).pos;
  t.call(() => playSfx('ui.button', { pan }));
  t.add(pressHeroPower(scene, view, cls), 0);
  t.call(() => playSfx(`hero_power.${cls}`, { pan }), undefined, press);
  t.add(heroPowerCast({ scene, cls, side: e.side, target: e.target ?? (cls === 'noxus' ? { side: other(e.side), kind: 'hero' } : null), from, summonAt }), press);
  const hit = heroPowerHit(cls);
  const end = stepEnd(hit, heroPowerDuration() - hit);
  addOrSpill(t, cooldownWipe(view, cls), press + HERO_POWER.cast, end);
  t.to({}, { duration: end }, 0);
  return { tl: t, tail: tailFor(end, hit) };
};
