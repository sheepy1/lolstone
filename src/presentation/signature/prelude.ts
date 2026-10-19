// 招牌法术的起手（spell_cast 那一步）：引擎不给 spell_cast 带 fxId，注册表按卡牌数据映射过来，这一步替掉通用的法术演出，
// 在展示位上放一小段这张卡自己颜色的蓄势（E09 的展示由出牌那一步做完，牌刚放大提亮缩没），声音层从这里起。
// 时长 0.3 秒、整段都算收尾：主步在 60% 处接上，蓄势和主步的开头叠在一起，不留空档。
import gsap from 'gsap';
import type { SfxId } from '../../audio';
import type { PresetDef } from '../fx/particles';
import { showcaseSlot } from '../layout';
import { at, sfx, span, temp } from './kit';
import { makeGroundRing } from './meshes';
import type { SignatureCtx, SignatureAnim } from './registry';

export type PreludeOptions = {
  color: number;
  preset: PresetDef | 'buff_ring' | 'frost_spread' | 'holy_pillar' | 'slash_trail';
  count?: number;
  scale?: number;
  sounds: SfxId[];
};

export const PRELUDE = { duration: 0.3 };

export function prelude(c: SignatureCtx, o: PreludeOptions): SignatureAnim {
  const { scene } = c;
  const t = gsap.timeline();
  const show = showcaseSlot().pos;
  at(t, 0, () => {
    for (const id of o.sounds) sfx(id, show.x);
    scene.particles.emit(o.preset, { at: { x: show.x, y: show.y - 0.9, z: show.z }, count: o.count, scale: o.scale ?? 0.7, color: o.color });
  });
  // 展示位下方一圈这张卡颜色的光环收拢：读起来是"大招在蓄力"
  const ring = temp(scene, t, 0, PRELUDE.duration, () => makeGroundRing(o.color, 1.5), (m) => {
    m.position.set(show.x, show.y - 0.6, show.z);
    m.rotation.x = -Math.PI / 2 + 0.5;
    m.scale.setScalar(1.6);
  });
  t.to({}, {
    duration: PRELUDE.duration,
    ease: 'power2.in',
    onUpdate() {
      const m = ring.get();
      if (!m) return;
      const k = this.progress();
      m.scale.setScalar(1.6 - 1.3 * k);
      m.material.opacity = 0.75 * Math.sin(Math.PI * Math.min(1, k * 1.2));
    },
  }, 0);
  span(t, PRELUDE.duration);
  return { tl: t, tail: PRELUDE.duration };
}
