// 法术施放（m4-storyboard E09 的溶解和效果段、E10 群体法术）。展示段（飞到中央、停、按 fx 色发光）在 cardPlayed。
// - 溶解 100ms（起）：接过展示中的牌，提亮、放大再缩没，散成 fx 色的光；magic 施法声在 t=0（群体法术用大法术音）；
// - 效果：按 fx 类型（spellFx.ts），群体法术每个目标同时各来一份，按横坐标错开 40ms；
// - 命中帧：单体在效果里写死的那一刻，群体是第一个目标的；报的 tail 让导演在第一个命中帧开始下一组（伤害、冻结、增益），
//   群体的下一组按同样的 40ms 错开，每个目标的效果和它的伤害落在同一帧；
// - 画面反馈：单体火焰命中棋盘闪火色、伤害 ≥ 4 打随从 S1；群体第一个命中帧棋盘闪 fx 色、S2（有益的不震）。
// 招牌卡（有 fxId）由招牌卡会话覆盖，这里是兜底。
import { playSfx } from '../../audio';
import { addOrSpill, dissolveCard, spellEffect, takeCast } from '../fx/spellFx';
import { hitTimes, planSpell, SPELL, spellSfx, stepEnd, tailFor } from '../fx/spellPlan';
import type { AnimModule } from './types';
import { tl } from './util';

export const spellCast: AnimModule<'spell_cast'> = (e, { scene, before }) => {
  const t = tl();
  const plan = planSpell(e.card.cardId, e.side, e.target, before);
  const hits = plan.targets.length > 0 ? hitTimes(plan, plan.targets.map((r) => scene.pointOf(r).x)) : [plan.hit];
  // 展示段停完才轮到这一步（cardPlayed 不报 tail），这时牌已经交过来了；没有时（被覆盖、出错）溶解段只放光点
  const card = takeCast(scene, e.card.instanceId);
  t.call(() => playSfx(spellSfx(plan), { pan: 0 }));
  t.add(dissolveCard(scene, card, plan.fx, plan.fx === 'holy' ? 'up' : 'out'), 0);
  const end = stepEnd(plan.hit, Math.max(...hits) - plan.hit + SPELL.residual);
  addOrSpill(t, spellEffect(scene, plan, e.side, hits), 0, end);
  t.to({}, { duration: end }, 0);
  return { tl: t, tail: tailFor(end, plan.hit) };
};
