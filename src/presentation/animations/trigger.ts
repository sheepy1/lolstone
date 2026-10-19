// 效果触发（战吼、亡语、连击、回合开始/结束、消灭、脚本）：来源亮一圈并标出时机，有选定目标时
// 从来源拉一道光指向目标、命中处闪光，再接动作本身的事件。
import { playSfx } from '../../audio';
import type { SourceRef, TargetRef, TriggerTiming } from '../../engine';
import type { TableScene } from '../../scene/table';
import { floatText, projectile, ring } from '../fx/effects';
import { showcaseSlot } from '../layout';
import type { AnimModule } from './types';
import { pointOf, tl } from './util';

const LABELS: Record<TriggerTiming, string> = {
  battlecry: '战吼',
  deathrattle: '亡语',
  combo: '连击',
  turn_start: '回合开始',
  turn_end: '回合结束',
  on_kill: '击杀',
  script: '特效',
};

function sourcePoint(scene: TableScene, s: SourceRef) {
  if (s.kind === 'minion') return pointOf(scene, { side: s.side, kind: 'minion', instanceId: s.instanceId } as TargetRef);
  if (s.kind === 'hero_power') return () => scene.heroPowerPoint(s.side);
  if (s.kind === 'spell') return () => showcaseSlot().pos;
  return pointOf(scene, { side: s.side, kind: 'hero' });
}

export const trigger: AnimModule<'trigger'> = (e, { scene }) => {
  const t = tl();
  const from = sourcePoint(scene, e.source);
  t.call(() => playSfx('ui.click'));
  t.add(ring(scene.layers.fx, from, 0xffd070, 70, 0.3));
  t.add(floatText(scene.layers.fx, () => ({ ...from(), y: from().y + 0.5 }), LABELS[e.timing], 0xffd070, 28), 0);
  if (e.target) {
    t.add(projectile(scene.layers.fx, from, pointOf(scene, e.target), 0xffd070, 0.25), 0.1);
    t.add(ring(scene.layers.fx, pointOf(scene, e.target), 0xffffff, 50, 0.2));
  }
  return { tl: t };
};
