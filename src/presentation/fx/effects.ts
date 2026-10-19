// 占位动画用的通用效果：飘字、闪光圈、飞弹、横幅、粒子。每个函数返回一条 GSAP 时间线，
// 显示对象在时间线播放时才创建（.call），播完自己销毁。M4 换成精细版本时这些函数的签名不变。
import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { FONT_CN, FONT_NUM } from '../../scene/theme';
import type { Point } from './arrow';

const MAX_PARTICLES = 2000; // spec 5.10
let liveParticles = 0;

function text(str: string, size: number, color: number, font = FONT_NUM): Text {
  const t = new Text({
    text: str,
    style: { fontFamily: font, fontSize: size, fill: color, fontWeight: '900', stroke: { color: 0x000000, width: Math.max(4, size / 6) } },
  });
  t.anchor.set(0.5);
  t.resolution = 2;
  return t;
}

// 伤害、治疗等飘字：弹出、上浮、淡出。
export function floatText(layer: Container, at: () => Point, str: string, color: number, size = 46): gsap.core.Timeline {
  const tl = gsap.timeline();
  let t: Text | null = null;
  const holder = { y: 0, a: 1, s: 0.4 };
  tl.call(() => {
    t = text(str, size, color);
    const p = at();
    t.position.set(p.x, p.y);
    t.scale.set(0.4);
    layer.addChild(t);
    holder.y = p.y;
  });
  tl.to(holder, {
    s: 1.15,
    duration: 0.14,
    ease: 'back.out(3)',
    onUpdate: () => t?.scale.set(holder.s),
  });
  tl.to(holder, {
    y: '-=46',
    a: 0,
    duration: 0.5,
    ease: 'power1.in',
    onUpdate: () => {
      if (!t) return;
      t.y = holder.y;
      t.alpha = holder.a;
    },
  });
  tl.call(() => t?.destroy());
  return tl;
}

// 扩散的光圈。
export function ring(layer: Container, at: () => Point, color: number, radius = 80, duration = 0.4): gsap.core.Timeline {
  const tl = gsap.timeline();
  let g: Graphics | null = null;
  const st = { r: 10, a: 1 };
  tl.call(() => {
    g = new Graphics();
    layer.addChild(g);
  });
  tl.to(st, {
    r: radius,
    a: 0,
    duration,
    ease: 'power2.out',
    onUpdate: () => {
      if (!g) return;
      const p = at();
      g.clear().circle(p.x, p.y, st.r).stroke({ width: 8, color, alpha: st.a });
    },
  });
  tl.call(() => g?.destroy());
  return tl;
}

// 飞弹：一个发光圆点从 from 飞到 to。
export function projectile(layer: Container, from: () => Point, to: () => Point, color: number, duration = 0.3): gsap.core.Timeline {
  const tl = gsap.timeline();
  let g: Graphics | null = null;
  const st = { t: 0 };
  tl.call(() => {
    g = new Graphics().circle(0, 0, 14).fill(color).circle(0, 0, 24).fill({ color, alpha: 0.35 });
    const p = from();
    g.position.set(p.x, p.y);
    layer.addChild(g);
  });
  tl.to(st, {
    t: 1,
    duration,
    ease: 'power1.in',
    onUpdate: () => {
      if (!g) return;
      const a = from();
      const b = to();
      g.position.set(a.x + (b.x - a.x) * st.t, a.y + (b.y - a.y) * st.t - Math.sin(st.t * Math.PI) * 60);
    },
  });
  tl.call(() => g?.destroy());
  return tl;
}

// 中央横幅："你的回合"、"对方回合"、"胜利"。滑入、停顿、淡出。
export function banner(layer: Container, center: Point, str: string, color: number, hold = 0.6, size = 84): gsap.core.Timeline {
  const tl = gsap.timeline();
  let c: Container | null = null;
  const st = { x: -400, a: 0 };
  tl.call(() => {
    c = new Container();
    const bg = new Graphics().rect(-560, -70, 1120, 140).fill({ color: 0x000000, alpha: 0.6 });
    bg.rect(-560, -70, 1120, 4).fill(0xc8aa6e).rect(-560, 66, 1120, 4).fill(0xc8aa6e);
    c.addChild(bg, text(str, size, color, FONT_CN));
    c.position.set(center.x + st.x, center.y);
    c.alpha = 0;
    layer.addChild(c);
  });
  const sync = () => {
    if (!c) return;
    c.x = center.x + st.x;
    c.alpha = st.a;
  };
  tl.to(st, { x: 0, a: 1, duration: 0.3, ease: 'power3.out', onUpdate: sync });
  tl.to(st, { duration: hold });
  tl.to(st, { x: 300, a: 0, duration: 0.3, ease: 'power2.in', onUpdate: sync });
  tl.call(() => c?.destroy({ children: true }));
  return tl;
}

// 粒子迸发：n 个小方块从中心向外飞散后消失。总数超过上限时不再生成（spec 5.10）。
export function burst(layer: Container, at: () => Point, color: number, n = 14, duration = 0.5): gsap.core.Timeline {
  const tl = gsap.timeline();
  const parts: { g: Graphics; vx: number; vy: number }[] = [];
  const st = { t: 0 };
  let origin: Point = { x: 0, y: 0 };
  tl.call(() => {
    origin = at();
    const count = Math.max(0, Math.min(n, MAX_PARTICLES - liveParticles));
    liveParticles += count;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 110;
      const g = new Graphics().rect(-4, -4, 8, 8).fill(color);
      g.position.set(origin.x, origin.y);
      layer.addChild(g);
      parts.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
    }
  });
  tl.to(st, {
    t: 1,
    duration,
    ease: 'power2.out',
    onUpdate: () => {
      for (const p of parts) {
        p.g.position.set(origin.x + p.vx * st.t, origin.y + p.vy * st.t + 40 * st.t * st.t);
        p.g.alpha = 1 - st.t;
      }
    },
  });
  tl.call(() => {
    liveParticles -= parts.length;
    for (const p of parts) p.g.destroy();
    parts.length = 0;
  });
  return tl;
}

// 空白等待，占住时间线上的一段时长。
export function wait(seconds: number): gsap.core.Timeline {
  return gsap.timeline().to({}, { duration: seconds });
}
