// 战斗飘字（m4-storyboard 1.8、E12、E13、E24）：伤害、治疗、"吸收"。字号三档（≤ 2 小、3 到 4 中、≥ 5 大），
// 深色描边约 2px（1080p 下），从目标上方弹出、上升后淡出（缓动"飘"：出现 power2.out，消失 power1.in）。
// 时间线只占"出现 + 上升"那一段，淡出在时间线之外接着播，不把这一步拖长。
import gsap from 'gsap';
import * as THREE from 'three';
import { FONT_NUM } from '../../scene/theme';
import { releaseTexture } from '../../scene/dispose';
import type { Vec3 } from '../layout';

export const FLOAT_TEXT = {
  sizes: { small: 0.46, mid: 0.6, big: 0.8 }, // 字高（世界单位；1080p 下 1 单位约 75 像素）
  outline: 0.11, // 描边线宽 / 字号（canvas 上描边一半在字外，0.11 约是 1080p 下的 2px）
  popIn: 0.09, // 弹出
  popScale: 1.2, // 弹出时先放大到
  rise: 0.3, // 上升（分镜 E12 的 300ms）
  hold: 0.08, // 升到顶后停一下再淡出，给玩家读数
  fade: 0.25, // 淡出
};

export type TextTier = keyof typeof FLOAT_TEXT.sizes;

export function tierOf(amount: number): TextTier {
  return amount >= 5 ? 'big' : amount >= 3 ? 'mid' : 'small';
}

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function makeSprite(str: string, color: number, height: number, font: string): THREE.Sprite {
  const px = 96;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = `900 ${px}px ${font}`;
  const pad = px * 0.3;
  c.width = Math.ceil(g.measureText(str).width + pad * 2);
  c.height = Math.ceil(px * 1.35);
  g.font = `900 ${px}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = px * FLOAT_TEXT.outline * 2;
  g.strokeStyle = '#140405';
  g.strokeText(str, c.width / 2, c.height / 2);
  g.fillStyle = css(color);
  g.fillText(str, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  const h = height * (c.height / px);
  s.scale.set((h * c.width) / c.height, h, 1);
  s.renderOrder = 20;
  return s;
}

// at 是飘字出现的位置（播放时才取）；rise 是上升高度（世界单位）
export function combatText(
  layer: THREE.Object3D,
  at: () => Vec3,
  str: string,
  color: number,
  tier: TextTier,
  rise: number,
  font = FONT_NUM,
): gsap.core.Timeline {
  const F = FLOAT_TEXT;
  const tl = gsap.timeline();
  let s: THREE.Sprite | null = null;
  const st = { k: 0.3, up: 0, a: 1 };
  const base = { x: 0, y: 0, z: 0, sx: 1, sy: 1 };
  const apply = () => {
    if (!s) return;
    s.position.set(base.x, base.y + st.up, base.z);
    s.scale.set(base.sx * st.k, base.sy * st.k, 1);
    s.material.opacity = st.a;
  };
  const release = () => {
    if (!s) return;
    s.removeFromParent();
    if (s.material.map) releaseTexture(s.material.map);
    s.material.dispose();
    s = null;
  };
  tl.call(() => {
    release();
    s = makeSprite(str, color, F.sizes[tier], font);
    const p = at();
    Object.assign(base, { x: p.x, y: p.y, z: p.z, sx: s.scale.x, sy: s.scale.y });
    layer.add(s);
    apply();
  });
  tl.to(st, { k: F.popScale, duration: F.popIn, ease: 'power2.out', onUpdate: apply });
  tl.to(st, { k: 1, up: rise, duration: F.rise, ease: 'power2.out', onUpdate: apply });
  // 淡出不占这一步的时长：交给全局时间线自己播完
  tl.call(() => {
    gsap.to(st, { a: 0, up: rise * 1.25, delay: F.hold, duration: F.fade, ease: 'power1.in', onUpdate: apply, onComplete: release, onInterrupt: release });
  });
  tl.eventCallback('onInterrupt', release);
  return tl;
}
