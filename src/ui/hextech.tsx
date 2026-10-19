// 菜单类页面（加载、主菜单、结算）共用的件：1920×1080 基准舞台的等比缩放、台面远景背景、漂浮粒子。
// 样式在 menu.css。
import { useEffect, useRef, useState, type ReactNode } from 'react';

// 菜单界面的中文字体：M3 做的思源宋体粗体子集（public/fonts），在 menu.css 里用 @font-face 声明。
// 子集只带卡池用到的字，缺的字由系统宋体补上。
export const MENU_FONT = 'MeLoL Serif SC';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

function currentScale(): number {
  return Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
}

// 按窗口大小算出 1920×1080 舞台的缩放比（spec 5.4：分辨率基准 1920×1080，等比缩放适配窗口）。
export function useStageScale(): number {
  const [scale, setScale] = useState(currentScale);
  useEffect(() => {
    const onResize = () => setScale(currentScale());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

// 1920×1080 的布局舞台，居中、等比缩放。里面的尺寸都按 1080p 写。
export function Stage({ children, className = '' }: { children: ReactNode; className?: string }) {
  const scale = useStageScale();
  return (
    <div className={`hx-stage ${className}`} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
      {children}
    </div>
  );
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// 台面远景背景（spec 5.1：加载页和主菜单的背景是棋盘远景）。
// 现在是 CSS 画的占位：深色天幕、透视的海克斯台面、远处台面中心的光、扫过的光束、漂浮粒子、暗角。
// live 为 true 时不画天幕和台面，只留粒子和暗角，让下面画布里的实时 3D 场景透上来；
// 以后场景层能渲染台面远景时，加载页和主菜单把 live 打开即可，页面本身不用改。
export function MenuBackdrop({ live = false }: { live?: boolean }) {
  return (
    <div className={`hx-backdrop ${live ? 'live' : ''}`} aria-hidden>
      {!live && (
        <>
          <div className="bd-sky" />
          <div className="bd-table">
            <div className="bd-plane" />
            <div className="bd-rim" />
            <div className="bd-core" />
          </div>
          <div className="bd-beam" />
        </>
      )}
      <Motes />
      <div className="bd-vignette" />
    </div>
  );
}

type Mote = { x: number; y: number; r: number; vy: number; vx: number; phase: number; hue: 'gold' | 'cyan' };

const MOTE_COUNT = 70;

function spawn(w: number, h: number, anywhere: boolean): Mote {
  return {
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : h + 10,
    r: 0.8 + Math.random() * 2.2,
    vy: 8 + Math.random() * 22,
    vx: -4 + Math.random() * 8,
    phase: Math.random() * Math.PI * 2,
    hue: Math.random() < 0.62 ? 'gold' : 'cyan',
  };
}

// 缓慢上升、明暗闪烁的光点（spec 5.1：主菜单背景有缓慢动的粒子）。2D canvas，页面不可见时随 rAF 一起停。
function Motes() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const motes = Array.from({ length: MOTE_COUNT }, () => spawn(w, h, true));
    const still = prefersReducedMotion();
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i]!;
        if (!still) {
          m.y -= m.vy * dt;
          m.x += (m.vx + Math.sin(now / 1700 + m.phase) * 6) * dt;
          if (m.y < -10) motes[i] = spawn(w, h, false);
        }
        // 越往上越淡，闪烁
        const fade = Math.min(1, m.y / (h * 0.55));
        const twinkle = 0.55 + 0.45 * Math.sin(now / 600 + m.phase * 3);
        const a = Math.max(0, fade * twinkle);
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 4);
        const rgb = m.hue === 'gold' ? '240, 200, 120' : '90, 220, 230';
        g.addColorStop(0, `rgba(${rgb}, ${0.9 * a})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className="bd-motes" />;
}
