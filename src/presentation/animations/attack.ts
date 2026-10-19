// 攻击：攻击方后仰蓄力 0.15 秒，直线冲向目标，撞击瞬间（impact）同一步里的受伤事件开始播，攻击方弹回原位。
import { playSfx } from '../../audio';
import type { AnimModule } from './types';
import { tl } from './util';

const WINDUP = 0.15;
const DASH = 0.14;
const RETURN = 0.3;

export const attack: AnimModule<'attack'> = (e, { scene }) => {
  const t = tl();
  const attacker = scene.targetBody(e.attacker);
  if (!attacker) return { tl: t.to({}, { duration: 0.2 }), impact: 0.2 };
  const body = attacker.body;
  const st = { k: 0 };
  let dx = 0;
  let dy = 0;
  t.call(() => {
    const a = scene.pointOf(e.attacker);
    const b = scene.pointOf(e.target);
    dx = b.x - a.x;
    dy = b.y - a.y;
    // 停在目标前面一点，不完全重叠
    const len = Math.hypot(dx, dy) || 1;
    const stop = Math.max(0, len - 70) / len;
    dx *= stop;
    dy *= stop;
    body.parent && (body.parent.zIndex = 50);
    playSfx('combat.swing');
  });
  const apply = () => body.position.set(dx * st.k, dy * st.k);
  t.to(st, { k: -0.12, duration: WINDUP, ease: 'power2.out', onUpdate: apply });
  t.to(st, { k: 1, duration: DASH, ease: 'power3.in', onUpdate: apply });
  t.to(st, { k: 0, duration: RETURN, ease: 'power2.out', onUpdate: apply });
  t.call(() => {
    body.position.set(0, 0);
    if (body.parent) body.parent.zIndex = 0;
  });
  return { tl: t, impact: WINDUP + DASH };
};
