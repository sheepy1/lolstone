// 法力变化（m4-storyboard E25，300ms）：变化的格子从左往右 50ms 错开亮或暗，自发光从 0 到 1、弹一下（法力条自己的动画）；
// 临时法力的格子是紫色。空水晶（凛冬将至这类，不在回合开始时）：新格子从 0 放大出现，带一个小 buff_ring。
// 声音：flow.mana 只播一次，不按格数叠。
import { playSfx } from '../../audio';
import type { AnimModule } from './types';
import { syncTo, tl } from './util';

export const manaChanged: AnimModule<'mana_changed'> = (e, { scene, after }) => {
  const t = tl();
  const bar = scene.mana[e.side];
  t.call(() => {
    playSfx('flow.mana', { pan: scene.panAt(bar.gemPoint(Math.max(0, e.after.max - 1))) });
    bar.set(e.after, true);
    if (e.reason !== 'turn_start' && e.after.max > e.before.max) {
      for (let i = e.before.max; i < e.after.max; i++) {
        const p = bar.gemPoint(i);
        scene.particles.emit('buff_ring', { at: { x: p.x, y: 0, z: p.z }, scale: 0.35 });
      }
    }
  });
  t.add(syncTo(scene, after, 0.3), 0);
  return { tl: t };
};
