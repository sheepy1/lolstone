// 效果触发（战吼、亡语、连击、回合开始/结束、击杀、脚本）。
// - 有选定目标（战吼、连击选目标，m4-storyboard E08，400ms）：来源亮一下，从来源拉出一道拱起的金色光线，头部 150ms 先到；
//   命中处白闪加 spark_light 6 粒；光线 170ms 淡出。动作本身的事件（伤害、冻结、增益）是下一组，按组间重叠在命中闪附近开始，
//   不等光线消失。
// - 没有目标：来源亮一圈、标出时机（"战吼""亡语"……）。回合开始、回合结束的效果（娑娜、斯维因、纳什男爵、冰凤凰蛋）
//   多一圈从底座往外扩的金环，让玩家看出"是它在这时候起作用了"。
// 声音：ui.click 在 t=0（拉出光线或亮起）；命中的 impact 交给后面的动作。
import { playSfx } from '../../audio';
import type { SourceRef, TargetRef, TriggerTiming } from '../../engine';
import type { TableScene } from '../../scene/table';
import { beam } from '../fx/beam';
import { floatText, ring } from '../fx/effects';
import { showcaseSlot } from '../layout';
import type { AnimModule } from './types';
import { flash, pointOf, tl } from './util';

const LABELS: Record<TriggerTiming, string> = {
  battlecry: '战吼',
  deathrattle: '亡语',
  combo: '连击',
  turn_start: '回合开始',
  turn_end: '回合结束',
  on_kill: '击杀',
  script: '特效',
};

export const TRIGGER = {
  lead: 0.05, // 来源亮起后多久拉出光线
  glow: 0.3, // 没有目标时来源亮一圈的时长
};

const GOLD = 0xffd070;

function sourcePoint(scene: TableScene, s: SourceRef) {
  if (s.kind === 'minion') return pointOf(scene, { side: s.side, kind: 'minion', instanceId: s.instanceId } as TargetRef);
  if (s.kind === 'hero_power') return () => scene.heroPowerPoint(s.side);
  if (s.kind === 'spell') return () => showcaseSlot().pos;
  return pointOf(scene, { side: s.side, kind: 'hero' });
}

function sourceBody(scene: TableScene, s: SourceRef) {
  if (s.kind === 'minion') return scene.targetBody({ side: s.side, kind: 'minion', instanceId: s.instanceId } as TargetRef);
  if (s.kind === 'hero') return scene.targetBody({ side: s.side, kind: 'hero' });
  return null;
}

export const trigger: AnimModule<'trigger'> = (e, { scene }) => {
  const t = tl();
  const from = sourcePoint(scene, e.source);
  const turn = e.timing === 'turn_start' || e.timing === 'turn_end';
  t.call(() => {
    playSfx('ui.click', { pan: scene.panAt(from()) });
    // 时机的字在后台飘，不占这一步的时长
    void floatText(scene.layers.fx, () => ({ ...from(), y: from().y + 0.6 }), LABELS[e.timing], GOLD, 26);
    const body = sourceBody(scene, e.source);
    if (body) flash(body.flash, GOLD, 0.7, 0.3);
    if (turn) scene.particles.emit('buff_ring', { at: { ...from(), y: 0 }, color: GOLD, scale: 0.8 });
  });
  if (e.target) {
    const target = pointOf(scene, e.target);
    const b = beam(scene.layers.fx, from, target, GOLD);
    t.add(b.tl, TRIGGER.lead);
    // 命中闪：目标白闪，spark_light 6 粒
    t.call(
      () => {
        const p = target();
        scene.particles.emit('spark_light', { at: { x: p.x, y: Math.max(p.y, 0.4), z: p.z }, count: 6 });
        const body = scene.targetBody(e.target!);
        if (body) flash(body.flash, 0xffffff, 0.9, 0.12);
      },
      undefined,
      TRIGGER.lead + b.hitAt,
    );
  } else {
    t.add(ring(scene.layers.fx, from, GOLD, turn ? 90 : 70, TRIGGER.glow), 0);
  }
  // 整段都算收尾：下一组（动作本身）在这一步进行到 60% 时开始，大约就是命中闪那一帧
  return { tl: t, tail: t.duration() };
};
