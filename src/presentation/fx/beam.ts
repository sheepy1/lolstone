// 触发效果的指向光线（m4-storyboard E08）：从来源到目标一条悬空拱起的海克斯能量带，头部先到、身体紧跟在后面，
// 命中处闪一下，然后淡出。造型和玩家拖的目标箭头同一套（arc.ts：拱弧、流动的菱形、海克斯箭头、台面投影、来源光团），
// 只是细一点；这里是事件播放时的演示，不接受输入，没有准星和吸附。
// 颜色按来源卡牌作用在选中目标上的动作（arrowTone）：伤害红橙、增益金色、冻结冰蓝；其余用海克斯金。
import gsap from 'gsap';
import * as THREE from 'three';
import { findCard, type SourceRef } from '../../engine';
import { ArcVisual, arcControls, newCtrl, type ArcStyle } from './arc';
import { ARROW_COLORS, arrowTone } from './arrow';

type Vec3 = { x: number; y: number; z: number };

export const BEAM = {
  grow: 0.15, // 拉出（落）：头部先到
  hit: 0.08, // 命中闪
  fade: 0.17, // 消失（飘的消失段）
};

export const BEAM_STYLE: ArcStyle = {
  glow: 2.4,
  archBase: 1.3,
  archPerUnit: 0.32,
  archMax: 4,
  width0: 0.32,
  width1: 0.18,
  diamonds: 1.25,
  flow: 3,
  headLength: 0.7,
  headWidth: 0.66,
  shadow: 0.5,
  sourceGlow: 0.7,
};

export const BEAM_GOLD = 0xffd070;

/** 光线颜色：看来源卡牌作用在选中目标上的动作；英雄、疲劳之类没有卡牌的来源和其余动作用海克斯金。 */
export function beamColor(source: SourceRef): number {
  const def = 'cardId' in source ? findCard(source.cardId) ?? null : null;
  const tone = arrowTone('card', def);
  return tone === 'default' ? BEAM_GOLD : ARROW_COLORS[tone];
}

// 返回时间线和命中时刻（相对时间线开头）。from、to 在时间线开始时取，跟上正在动的物件
export function beam(
  layer: THREE.Object3D,
  camera: THREE.Camera,
  from: () => Vec3,
  to: () => Vec3,
  color = BEAM_GOLD,
): { tl: gsap.core.Timeline; hitAt: number } {
  const t = gsap.timeline();
  const arc = new ArcVisual(BEAM_STYLE);
  const ctrl = newCtrl();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const col = new THREE.Color(color);
  const st = { k: 0, a: 1 };
  const apply = () =>
    arc.draw({
      from: a,
      ctrl,
      headT: Math.max(0.001, st.k),
      color: col,
      intensity: 1,
      rim: 1.4,
      alpha: st.a,
      // 来源光团：拉出时最亮，随后变小
      glow: 1.5 - 0.6 * st.k,
      time: t.time(),
      camera,
    });
  t.call(() => {
    const a0 = from();
    const b0 = to();
    a.set(a0.x, Math.max(a0.y, 0.35) + 0.15, a0.z);
    b.set(b0.x, Math.max(b0.y, 0.35) + 0.12, b0.z);
    arcControls(a, b, ctrl, BEAM_STYLE);
    st.k = 0;
    st.a = 1;
    layer.add(arc);
    apply();
  });
  // 拉出（落）：头部 150ms 到目标，身体紧跟在后面
  t.to(st, { k: 1, duration: BEAM.grow, ease: 'power2.out', onUpdate: apply });
  const hitAt = BEAM.grow;
  // 命中闪之后消失（飘的消失段）
  t.to(st, { a: 0, duration: BEAM.fade, ease: 'power1.in', onUpdate: apply }, hitAt + BEAM.hit);
  t.call(() => {
    arc.removeFromParent();
    arc.release();
  });
  return { tl: t, hitAt };
}
