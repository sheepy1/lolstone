// 卡框和卡背（M4 美术，spec 5.4）：canvas 程序绘制，不用外部图。版式和 M3 一样（cardText.ts 的文字位置不动），
// 换的是材质感：
// - 边框是带倒角高光的金属（多段渐变模拟抛光金属的明暗带，叠一层拉丝纹理），按地区配色：德玛西亚金白、
//   诺克萨斯黑铁加红、艾欧尼亚粉紫、弗雷尔卓德冰蓝、中立石灰；
// - 英雄卡和非英雄卡一眼分开：英雄卡边框里嵌一道地区色的金属线，顶上有带宝石的冠饰，四角和横幅两端有饰钉、
//   横幅两端是尖角；非英雄卡是素边框，横幅两端平切；
// - 费用六边形是切面宝石加金属外圈，攻击、生命是同样做法的琥珀色、红色六边形，名字横幅是深色金属板，
//   文本框是内凹的面板（德玛西亚是浅色羊皮纸，其余是深色）；
// - 卡背是海克斯风格：深蓝黑底、六边形网格暗纹、同心六边形的金色徽记，中间一颗发光的海克斯核心。
// 每种版式（英雄或非英雄 × 随从或法术，加卡背）另有一张共用的法线贴图和粗糙度 / 金属度贴图（cardFaceMaps），
// 由同一套形状画出高度再求法线，卡面在 3D 里有真的凹凸和金属反光，不只是画出来的明暗。
// 全部在第一次用到时画一次并缓存。
import * as THREE from 'three';
import type { CardClass, CardDef } from '../engine';
import { bevelPath, hexPath } from './canvasPaths';
import { shared } from './dispose';

const CW = 512;
const CH = 716;
const FB = 30; // 边框宽度

// 版式（和 cardText.ts、M3 的底图一致）
const ART = { x: 66, y: 62, w: 380, h: 380 * 0.86 };
const BANNER = { x: 26, y: 399, w: 460, h: 66 };
const BOX = { x: 48, y: 475, w: 416, h: 181 };
const COST = { x: 70, y: 70, r: 54 };
const STATS = { y: CH - 72, r: 50, atk: 72, hp: CW - 72 };

type Pal = {
  hi: string; // 金属高光
  mid: string;
  lo: string;
  edge: string; // 最暗的边
  inner: [string, string]; // 边框内的底板，上到下
  accent: string; // 嵌线、饰钉
  accentHi: string;
  box: [string, string]; // 文本框
  boxLine: string;
  banner: [string, string];
};

const PAL: Record<CardClass, Pal> = {
  demacia: {
    hi: '#fff7de', mid: '#d6bd76', lo: '#8a6e2e', edge: '#40300e',
    inner: ['#e9dfc2', '#b9aa84'], accent: '#3d5c9a', accentHi: '#a9c6ff',
    box: ['#f7f0dd', '#e3d6b5'], boxLine: '#a8873a', banner: ['#2b3a62', '#121a30'],
  },
  noxus: {
    hi: '#8c7c7e', mid: '#3a2f31', lo: '#171012', edge: '#070304',
    inner: ['#2c1517', '#120809'], accent: '#c8302c', accentHi: '#ff8a70',
    box: ['#1e0f10', '#0d0607'], boxLine: '#7a2226', banner: ['#4a0f13', '#1a0506'],
  },
  ionia: {
    hi: '#ffdcf3', mid: '#c37ab6', lo: '#5c2a5a', edge: '#260c24',
    inner: ['#3a2342', '#1c1022'], accent: '#ffb4e4', accentHi: '#fff0fa',
    box: ['#26172c', '#140b18'], boxLine: '#a05a96', banner: ['#43214a', '#1b0c20'],
  },
  freljord: {
    hi: '#f2fcff', mid: '#88c9ea', lo: '#2c5c7c', edge: '#0c2030',
    inner: ['#1e384c', '#0c1a26'], accent: '#e6f7ff', accentHi: '#ffffff',
    box: ['#142838', '#0a1620'], boxLine: '#6aa8cc', banner: ['#183550', '#0a1724'],
  },
  neutral: {
    hi: '#e6e4d8', mid: '#8f8d83', lo: '#3e3d38', edge: '#191916',
    inner: ['#302f2b', '#191817'], accent: '#c8aa6e', accentHi: '#f4e2b0',
    box: ['#23221f', '#141312'], boxLine: '#77746a', banner: ['#2c2b28', '#141412'],
  },
};

/** 把原画画进 (x, y, w, h)；调用前已经裁好窗口。 */
export type DrawArt = (x: number, y: number, w: number, h: number) => void;

// ---------- 通用的金属画法 ----------

// 拉丝纹理：横向的长条明暗，叠在金属上（soft-light）
let brushed: HTMLCanvasElement | null = null;
function brushedPattern(g: CanvasRenderingContext2D): CanvasPattern {
  if (!brushed) {
    brushed = document.createElement('canvas');
    brushed.width = brushed.height = 256;
    const b = brushed.getContext('2d')!;
    const img = b.createImageData(256, 256);
    let s = 3;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let y = 0; y < 256; y++) {
      let v = rnd();
      const row = 0.4 + 0.6 * rnd();
      for (let x = 0; x < 256; x++) {
        v += (rnd() - 0.5) * 0.08;
        v = Math.min(1, Math.max(0, v * 0.98 + 0.01));
        const c = 128 + (v - 0.5) * 120 * row;
        img.data.set([c, c, c, 255], (y * 256 + x) * 4);
      }
    }
    b.putImageData(img, 0, 0);
  }
  return g.createPattern(brushed, 'repeat')!;
}

// 抛光金属：沿对角线的几段明暗带
function metalGradient(g: CanvasRenderingContext2D, p: Pal, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, p.hi);
  gr.addColorStop(0.12, p.mid);
  gr.addColorStop(0.32, p.lo);
  gr.addColorStop(0.5, p.mid);
  gr.addColorStop(0.62, p.hi);
  gr.addColorStop(0.78, p.mid);
  gr.addColorStop(1, p.lo);
  return gr;
}

// 填一块金属（当前路径），再叠拉丝
function fillMetal(g: CanvasRenderingContext2D, p: Pal, x0: number, y0: number, x1: number, y1: number, brush = 0.35): void {
  g.fillStyle = metalGradient(g, p, x0, y0, x1, y1);
  g.fill();
  g.save();
  g.clip();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = brush;
  g.fillStyle = brushedPattern(g);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.restore();
}

// 倒角的受光边：沿当前路径描边，左上亮、右下暗（凸起）；inverse 时反过来（凹下）
function bevelStroke(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, width: number, light: string, dark: string, inverse = false): void {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, inverse ? dark : light);
  gr.addColorStop(0.5, 'rgba(0,0,0,0)');
  gr.addColorStop(1, inverse ? light : dark);
  g.lineWidth = width;
  g.strokeStyle = gr;
  g.stroke();
}

// 区域内侧的阴影（凹槽、窗口的内缘）
function innerShadow(g: CanvasRenderingContext2D, path: () => void, blur: number, alpha: number): void {
  g.save();
  path();
  g.clip();
  g.shadowColor = `rgba(0,0,0,${alpha})`;
  g.shadowBlur = blur;
  g.lineWidth = blur;
  g.strokeStyle = '#000';
  path();
  g.stroke();
  g.restore();
}

// 饰钉：一颗小的金属圆头
function rivet(g: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pal): void {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  gr.addColorStop(0, p.accentHi);
  gr.addColorStop(0.55, p.accent);
  gr.addColorStop(1, p.edge);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = gr;
  g.fill();
}

// 切面宝石（六边形）：径向渐变加六个三角切面，外面一圈金属
function hexGem(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rim: Pal, colors: [string, string, string]): void {
  hexPath(g, cx, cy, r + 6);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fill();
  hexPath(g, cx, cy, r);
  fillMetal(g, rim, cx - r, cy - r, cx + r, cy + r, 0.2);
  hexPath(g, cx, cy, r - 1.5);
  bevelStroke(g, cx - r, cy - r, cx + r, cy + r, 3, 'rgba(255,255,255,0.75)', 'rgba(0,0,0,0.7)');
  const ri = r * 0.8;
  const gr = g.createRadialGradient(cx - ri * 0.3, cy - ri * 0.35, ri * 0.05, cx, cy, ri * 1.05);
  gr.addColorStop(0, colors[0]);
  gr.addColorStop(0.5, colors[1]);
  gr.addColorStop(1, colors[2]);
  hexPath(g, cx, cy, ri);
  g.fillStyle = gr;
  g.fill();
  // 切面：六个三角，朝左上的亮、朝右下的暗
  for (let i = 0; i < 6; i++) {
    const a0 = (Math.PI / 3) * i + Math.PI / 6;
    const a1 = a0 + Math.PI / 3;
    const mid = (a0 + a1) / 2;
    const lit = -Math.cos(mid - Math.PI * 1.25);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a0) * ri, cy + Math.sin(a0) * ri);
    g.lineTo(cx + Math.cos(a1) * ri, cy + Math.sin(a1) * ri);
    g.closePath();
    g.fillStyle = lit > 0 ? `rgba(255,255,255,${0.12 * lit})` : `rgba(0,0,0,${-0.22 * lit})`;
    g.fill();
  }
  // 台面：中间一块小六边形，略亮
  hexPath(g, cx, cy, ri * 0.48);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fill();
  // 高光
  g.save();
  hexPath(g, cx, cy, ri);
  g.clip();
  const hl = g.createRadialGradient(cx - ri * 0.35, cy - ri * 0.5, 1, cx - ri * 0.35, cy - ri * 0.5, ri * 0.6);
  hl.addColorStop(0, 'rgba(255,255,255,0.55)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  g.fillRect(cx - ri, cy - ri, ri * 2, ri * 2);
  g.restore();
  hexPath(g, cx, cy, ri);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.stroke();
}

const GEM_MANA: [string, string, string] = ['#bfe4ff', '#2f8cff', '#0a2a70'];
const GEM_ATK: [string, string, string] = ['#fff0b0', '#e0a424', '#5e3a06'];
const GEM_HP: [string, string, string] = ['#ffb4a8', '#cf322c', '#480807'];
const GOLD_RIM: Pal = { ...PAL.neutral, hi: '#fff4cc', mid: '#c8aa6e', lo: '#6e5424', edge: '#2a1e08' };

// 名字横幅的轮廓：英雄卡两端尖角，非英雄卡两端平切
function bannerPath(g: CanvasRenderingContext2D, inset: number, champion: boolean): void {
  const { x, y, w, h } = BANNER;
  const tip = champion ? 22 : 10;
  const x0 = x + inset;
  const x1 = x + w - inset;
  const y0 = y + inset;
  const y1 = y + h - inset;
  const ym = y + h / 2;
  g.beginPath();
  g.moveTo(x0, ym);
  g.lineTo(x0 + tip, y0);
  g.lineTo(x1 - tip, y0);
  g.lineTo(x1, ym);
  g.lineTo(x1 - tip, y1);
  g.lineTo(x0 + tip, y1);
  g.closePath();
}

// 英雄卡的冠饰：顶边正中一块带宝石的金属饰件，两侧伸出两道翼
function crest(g: CanvasRenderingContext2D, p: Pal): void {
  const cx = CW / 2;
  const cy = 30;
  g.beginPath();
  g.moveTo(cx - 92, cy - 6);
  g.lineTo(cx - 40, cy - 14);
  g.lineTo(cx - 22, cy - 26);
  g.lineTo(cx + 22, cy - 26);
  g.lineTo(cx + 40, cy - 14);
  g.lineTo(cx + 92, cy - 6);
  g.lineTo(cx + 40, cy + 14);
  g.lineTo(cx + 22, cy + 30);
  g.lineTo(cx - 22, cy + 30);
  g.lineTo(cx - 40, cy + 14);
  g.closePath();
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.fillStyle = '#000';
  g.fill();
  g.restore();
  fillMetal(g, { ...p, hi: p.accentHi, mid: p.accent }, cx - 92, cy - 26, cx + 92, cy + 30, 0.25);
  bevelStroke(g, cx - 92, cy - 26, cx + 92, cy + 30, 2.5, 'rgba(255,255,255,0.8)', 'rgba(0,0,0,0.75)');
  // 翼上的刻线
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * 84, cy - 4);
    g.lineTo(cx + s * 38, cy - 8);
    g.moveTo(cx + s * 84, cy - 1);
    g.lineTo(cx + s * 38, cy + 8);
    g.stroke();
  }
  hexGem(g, cx, cy + 2, 17, GOLD_RIM, ['#ffffff', p.accentHi, p.accent]);
}

// 英雄卡原画窗框外再绕一道地区色的细线，四角各一个折角的金属角饰
function artOrnaments(g: CanvasRenderingContext2D, p: Pal): void {
  const x0 = ART.x - 15;
  const y0 = ART.y - 15;
  const w = ART.w + 30;
  const h = ART.h + 30;
  bevelPath(g, x0, y0, w, h, 34);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = p.accent;
  g.stroke();
  const L = 46;
  const corners: [number, number, number, number][] = [
    [x0 - 3, y0 + 30, 1, 1],
    [x0 + w + 3, y0 + 30, -1, 1],
    [x0 - 3, y0 + h - 30, 1, -1],
    [x0 + w + 3, y0 + h - 30, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    // 沿切角折一下的角饰：竖边、斜边、横边
    g.beginPath();
    g.moveTo(x, y + sy * L * 0.6);
    g.lineTo(x, y);
    g.lineTo(x + sx * 30, y - sy * 30);
    g.lineTo(x + sx * (30 + L * 0.6), y - sy * 30);
    g.lineTo(x + sx * (30 + L * 0.6), y - sy * 23);
    g.lineTo(x + sx * 33, y - sy * 23);
    g.lineTo(x + sx * 7, y + sy * 3);
    g.lineTo(x + sx * 7, y + sy * L * 0.6);
    g.closePath();
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 4;
    g.shadowOffsetY = 2;
    g.fillStyle = '#000';
    g.fill();
    g.restore();
    fillMetal(g, { ...p, hi: p.accentHi, mid: p.accent }, x - 40, y - 40, x + 40, y + 40, 0.2);
  }
}

// 边框内底板上的六边形暗纹
function hexEngraving(g: CanvasRenderingContext2D, alpha: number): void {
  const r = 26;
  const dx = r * Math.sqrt(3);
  g.lineWidth = 1;
  for (let row = 0, y = 0; y < CH + r; row++, y += r * 1.5) {
    for (let x = row % 2 ? dx / 2 : 0; x < CW + dx; x += dx) {
      hexPath(g, x, y, r - 2);
      g.strokeStyle = `rgba(0,0,0,${alpha})`;
      g.stroke();
      hexPath(g, x + 0.8, y + 0.8, r - 2);
      g.strokeStyle = `rgba(255,255,255,${alpha * 0.45})`;
      g.stroke();
    }
  }
}

// ---------- 卡面 ----------

export function paintCardFace(g: CanvasRenderingContext2D, def: CardDef, drawArt: DrawArt): void {
  const p = PAL[def.class];
  const champion = !!def.champion;
  const minion = def.type === 'minion';
  g.clearRect(0, 0, CW, CH);
  g.save();

  // 外框金属
  bevelPath(g, 0, 0, CW, CH, 48);
  fillMetal(g, p, 0, 0, CW, CH, 0.4);
  bevelPath(g, 3, 3, CW - 6, CH - 6, 46);
  bevelStroke(g, 0, 0, CW, CH, 5, 'rgba(255,255,255,0.7)', 'rgba(0,0,0,0.8)');

  // 边框内的底板：渐变加六边形暗纹，边缘压一圈内阴影
  const inner = () => bevelPath(g, FB, FB, CW - FB * 2, CH - FB * 2, 30);
  inner();
  const ig = g.createLinearGradient(0, FB, 0, CH - FB);
  ig.addColorStop(0, p.inner[0]);
  ig.addColorStop(1, p.inner[1]);
  g.fillStyle = ig;
  g.fill();
  g.save();
  inner();
  g.clip();
  hexEngraving(g, def.class === 'demacia' ? 0.12 : 0.28);
  g.restore();
  innerShadow(g, inner, 14, 0.75);
  inner();
  bevelStroke(g, FB, FB, CW - FB, CH - FB, 2.5, 'rgba(255,255,255,0.55)', 'rgba(0,0,0,0.85)', true);

  if (champion) {
    // 英雄卡：边框里嵌一道地区色的金属线，四角饰钉
    bevelPath(g, FB * 0.45, FB * 0.45, CW - FB * 0.9, CH - FB * 0.9, 40);
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = p.accent;
    g.stroke();
    bevelPath(g, FB * 0.45 - 1, FB * 0.45 - 1, CW - FB * 0.9, CH - FB * 0.9, 40);
    g.lineWidth = 1;
    g.strokeStyle = p.accentHi;
    g.stroke();
    for (const [x, y] of [
      [FB * 0.45 + 12, FB * 0.45 + 12],
      [CW - FB * 0.45 - 12, FB * 0.45 + 12],
      [FB * 0.45 + 12, CH - FB * 0.45 - 12],
      [CW - FB * 0.45 - 12, CH - FB * 0.45 - 12],
    ] as const) {
      rivet(g, x, y, 6, p);
    }
    for (const y of [CH * 0.36, CH * 0.62]) {
      rivet(g, FB * 0.5, y, 5, p);
      rivet(g, CW - FB * 0.5, y, 5, p);
    }
  } else {
    // 非英雄卡：素边框，只在边框上刻一道细槽
    bevelPath(g, FB * 0.5, FB * 0.5, CW - FB, CH - FB, 40);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.stroke();
    bevelPath(g, FB * 0.5 + 1.2, FB * 0.5 + 1.2, CW - FB, CH - FB, 40);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.stroke();
  }

  // 原画窗口：金属窗框，原画边缘压内阴影，像嵌在框里
  const ax = ART.x;
  const ay = ART.y;
  bevelPath(g, ax - 9, ay - 9, ART.w + 18, ART.h + 18, 30);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.7)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  g.fillStyle = '#000';
  g.fill();
  g.restore();
  bevelPath(g, ax - 9, ay - 9, ART.w + 18, ART.h + 18, 30);
  fillMetal(g, p, ax - 9, ay - 9, ax + ART.w + 9, ay + ART.h + 9, 0.3);
  bevelPath(g, ax - 8, ay - 8, ART.w + 16, ART.h + 16, 29);
  bevelStroke(g, ax, ay, ax + ART.w, ay + ART.h, 2.5, 'rgba(255,255,255,0.7)', 'rgba(0,0,0,0.7)');
  const win = () => bevelPath(g, ax, ay, ART.w, ART.h, 24);
  g.save();
  win();
  g.clip();
  drawArt(ax, ay, ART.w, ART.h);
  g.restore();
  innerShadow(g, win, 12, 0.7);
  win();
  bevelStroke(g, ax, ay, ax + ART.w, ay + ART.h, 2, 'rgba(255,255,255,0.5)', 'rgba(0,0,0,0.9)', true);
  if (champion) artOrnaments(g, p);

  // 名字横幅：深色金属板，金属包边，上半截一道反光
  bannerPath(g, 0, champion);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.65)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  g.fillStyle = '#000';
  g.fill();
  g.restore();
  bannerPath(g, 0, champion);
  fillMetal(g, p, BANNER.x, BANNER.y, BANNER.x + BANNER.w, BANNER.y + BANNER.h, 0.3);
  bannerPath(g, 6, champion);
  const bg = g.createLinearGradient(0, BANNER.y, 0, BANNER.y + BANNER.h);
  bg.addColorStop(0, p.banner[0]);
  bg.addColorStop(1, p.banner[1]);
  g.fillStyle = bg;
  g.fill();
  g.save();
  bannerPath(g, 6, champion);
  g.clip();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.5;
  g.fillStyle = brushedPattern(g);
  g.fillRect(BANNER.x, BANNER.y, BANNER.w, BANNER.h);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const sheen = g.createLinearGradient(0, BANNER.y + 6, 0, BANNER.y + BANNER.h / 2);
  sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(BANNER.x, BANNER.y, BANNER.w, BANNER.h / 2);
  g.restore();
  bannerPath(g, 6, champion);
  bevelStroke(g, 0, BANNER.y, 0, BANNER.y + BANNER.h, 2, 'rgba(0,0,0,0.9)', 'rgba(255,255,255,0.3)');
  bannerPath(g, 1, champion);
  bevelStroke(g, 0, BANNER.y, 0, BANNER.y + BANNER.h, 2, 'rgba(255,255,255,0.7)', 'rgba(0,0,0,0.7)');
  if (champion) {
    // 两端尖角上各一颗饰钉
    rivet(g, BANNER.x + 13, BANNER.y + BANNER.h / 2, 6, p);
    rivet(g, BANNER.x + BANNER.w - 13, BANNER.y + BANNER.h / 2, 6, p);
  }

  // 文本框：内凹的面板
  const box = () => bevelPath(g, BOX.x, BOX.y, BOX.w, BOX.h, 16);
  box();
  const tg = g.createLinearGradient(0, BOX.y, 0, BOX.y + BOX.h);
  tg.addColorStop(0, p.box[0]);
  tg.addColorStop(1, p.box[1]);
  g.fillStyle = tg;
  g.fill();
  g.save();
  box();
  g.clip();
  // 纸面或石板的细纹
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = def.class === 'demacia' ? 0.35 : 0.25;
  g.fillStyle = brushedPattern(g);
  g.translate(BOX.x, BOX.y);
  g.rotate(0.02);
  g.fillRect(-20, -20, BOX.w + 40, BOX.h + 40);
  g.restore();
  innerShadow(g, box, 12, def.class === 'demacia' ? 0.35 : 0.7);
  box();
  bevelStroke(g, BOX.x, BOX.y, BOX.x + BOX.w, BOX.y + BOX.h, 2, 'rgba(255,255,255,0.45)', 'rgba(0,0,0,0.6)', true);
  bevelPath(g, BOX.x - 3, BOX.y - 3, BOX.w + 6, BOX.h + 6, 18);
  g.lineWidth = 1.5;
  g.strokeStyle = p.boxLine;
  g.stroke();

  if (champion) crest(g, p);

  // 费用：蓝色切面宝石，金色外圈
  hexGem(g, COST.x, COST.y, COST.r, GOLD_RIM, GEM_MANA);
  if (minion) {
    hexGem(g, STATS.atk, STATS.y, STATS.r, GOLD_RIM, GEM_ATK);
    hexGem(g, STATS.hp, STATS.y, STATS.r, GOLD_RIM, GEM_HP);
  }
  g.restore();
}

// ---------- 卡背 ----------

const BACK_PAL: Pal = {
  hi: '#fff1c8', mid: '#c8aa6e', lo: '#6a5022', edge: '#241806',
  inner: ['#13213a', '#070c18'], accent: '#c8aa6e', accentHi: '#fff1c8',
  box: ['#000', '#000'], boxLine: '#000', banner: ['#000', '#000'],
};

export function paintCardBack(g: CanvasRenderingContext2D): void {
  const p = BACK_PAL;
  g.clearRect(0, 0, CW, CH);
  // 金色外框
  bevelPath(g, 0, 0, CW, CH, 48);
  fillMetal(g, p, 0, 0, CW, CH, 0.35);
  bevelPath(g, 3, 3, CW - 6, CH - 6, 46);
  bevelStroke(g, 0, 0, CW, CH, 5, 'rgba(255,255,255,0.75)', 'rgba(0,0,0,0.8)');
  // 深色底：中间亮一点的径向渐变，六边形网格暗纹
  const inner = () => bevelPath(g, 24, 24, CW - 48, CH - 48, 32);
  inner();
  const bg = g.createRadialGradient(CW / 2, CH / 2, 20, CW / 2, CH / 2, CH * 0.62);
  bg.addColorStop(0, '#1d3560');
  bg.addColorStop(0.5, p.inner[0]);
  bg.addColorStop(1, p.inner[1]);
  g.fillStyle = bg;
  g.fill();
  g.save();
  inner();
  g.clip();
  hexEngraving(g, 0.45);
  // 网格上零星几格亮着的蓝线，像海克斯电路
  g.lineWidth = 1.5;
  for (const [x, y] of [[0.22, 0.2], [0.78, 0.26], [0.18, 0.74], [0.8, 0.8], [0.5, 0.1], [0.5, 0.9]] as const) {
    hexPath(g, x * CW, y * CH, 22);
    g.strokeStyle = 'rgba(90,170,255,0.35)';
    g.stroke();
  }
  g.restore();
  innerShadow(g, inner, 18, 0.85);
  inner();
  bevelStroke(g, 24, 24, CW - 24, CH - 24, 2.5, 'rgba(255,255,255,0.5)', 'rgba(0,0,0,0.9)', true);
  // 内圈金线，四角向内的切角
  bevelPath(g, 40, 40, CW - 80, CH - 80, 34);
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.stroke();
  bevelPath(g, 39, 39, CW - 80, CH - 80, 34);
  g.lineWidth = 1.5;
  g.strokeStyle = '#b8964e';
  g.stroke();
  // 上下两道竖线连到徽记
  for (const [y0, y1] of [[48, CH / 2 - 150], [CH / 2 + 150, CH - 48]] as const) {
    g.beginPath();
    g.moveTo(CW / 2, y0);
    g.lineTo(CW / 2, y1);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = '#b8964e';
    g.stroke();
  }
  for (const y of [48, CH - 48]) {
    g.beginPath();
    g.moveTo(CW / 2, y - 10);
    g.lineTo(CW / 2 + 14, y);
    g.lineTo(CW / 2, y + 10);
    g.lineTo(CW / 2 - 14, y);
    g.closePath();
    fillMetal(g, p, CW / 2 - 14, y - 10, CW / 2 + 14, y + 10, 0.2);
  }
  // 中间的徽记：三圈同心六边形，外圈带六个尖角，最里面是发光的海克斯核心
  const cx = CW / 2;
  const cy = CH / 2;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.75)';
  g.shadowBlur = 16;
  g.shadowOffsetY = 5;
  hexPath(g, cx, cy, 142);
  g.fillStyle = '#000';
  g.fill();
  g.restore();
  // 外圈：六个尖角
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i + Math.PI / 6;
    const r = i % 2 === 0 ? 150 : 118;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  fillMetal(g, p, cx - 150, cy - 150, cx + 150, cy + 150, 0.3);
  bevelStroke(g, cx - 150, cy - 150, cx + 150, cy + 150, 3, 'rgba(255,255,255,0.8)', 'rgba(0,0,0,0.75)');
  hexPath(g, cx, cy, 104);
  g.fillStyle = '#0a1426';
  g.fill();
  innerShadow(g, () => hexPath(g, cx, cy, 104), 14, 0.9);
  // 中圈：暗金属环加刻线
  hexPath(g, cx, cy, 90);
  fillMetal(g, { ...p, hi: '#9aa6b8', mid: '#3a4250', lo: '#141820' }, cx - 90, cy - 90, cx + 90, cy + 90, 0.35);
  hexPath(g, cx, cy, 89);
  bevelStroke(g, cx - 90, cy - 90, cx + 90, cy + 90, 2, 'rgba(255,255,255,0.6)', 'rgba(0,0,0,0.8)');
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 62, cy + Math.sin(a) * 62);
    g.lineTo(cx + Math.cos(a) * 88, cy + Math.sin(a) * 88);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.stroke();
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(200,170,110,0.9)';
    g.stroke();
  }
  // 内圈金边
  hexPath(g, cx, cy, 62);
  fillMetal(g, p, cx - 62, cy - 62, cx + 62, cy + 62, 0.2);
  hexPath(g, cx, cy, 61);
  bevelStroke(g, cx - 62, cy - 62, cx + 62, cy + 62, 2, 'rgba(255,255,255,0.8)', 'rgba(0,0,0,0.8)');
  // 核心：发光的蓝色海克斯晶体
  const core = g.createRadialGradient(cx - 8, cy - 10, 2, cx, cy, 52);
  core.addColorStop(0, '#f2fbff');
  core.addColorStop(0.25, '#8fe6ff');
  core.addColorStop(0.6, '#1f8fd8');
  core.addColorStop(1, '#06264a');
  hexPath(g, cx, cy, 50);
  g.fillStyle = core;
  g.fill();
  for (let i = 0; i < 6; i++) {
    const a0 = (Math.PI / 3) * i + Math.PI / 6;
    const a1 = a0 + Math.PI / 3;
    const lit = -Math.cos((a0 + a1) / 2 - Math.PI * 1.25);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a0) * 50, cy + Math.sin(a0) * 50);
    g.lineTo(cx + Math.cos(a1) * 50, cy + Math.sin(a1) * 50);
    g.closePath();
    g.fillStyle = lit > 0 ? `rgba(255,255,255,${0.14 * lit})` : `rgba(0,10,40,${-0.3 * lit})`;
    g.fill();
  }
  // 核心向外的光晕
  const halo = g.createRadialGradient(cx, cy, 30, cx, cy, 120);
  halo.addColorStop(0, 'rgba(120,210,255,0.35)');
  halo.addColorStop(1, 'rgba(120,210,255,0)');
  g.save();
  g.globalCompositeOperation = 'lighter';
  hexPath(g, cx, cy, 104);
  g.clip();
  g.fillStyle = halo;
  g.fillRect(cx - 120, cy - 120, 240, 240);
  g.restore();
}

// ---------- 法线、粗糙度、金属度贴图 ----------

export type FaceLayout = 'back' | `${'hero' | 'plain'}-${'minion' | 'spell'}`;

export function faceLayout(def: CardDef | null): FaceLayout {
  if (!def) return 'back';
  return `${def.champion ? 'hero' : 'plain'}-${def.type === 'minion' ? 'minion' : 'spell'}`;
}

// 灰度高度（越亮越高）和材质（g 通道粗糙度、b 通道金属度）按同一套形状画。
// h：0 到 1 的高度；rough、metal：0 到 1
type Mat = { h: number; rough: number; metal: number };
const METAL: Mat = { h: 0.85, rough: 0.34, metal: 0.65 };

function paintMaps(layout: FaceLayout, hg: CanvasRenderingContext2D, mg: CanvasRenderingContext2D): void {
  const set = (m: Mat, fill: () => void, hOverride?: string | CanvasGradient) => {
    const v = Math.round(m.h * 255);
    hg.fillStyle = hOverride ?? `rgb(${v},${v},${v})`;
    fill();
    hg.fill();
    mg.fillStyle = `rgb(0,${Math.round(m.rough * 255)},${Math.round(m.metal * 255)})`;
    mg.fill();
  };
  // 两个 context 走同一条路径
  const path = (fn: (g: CanvasRenderingContext2D) => void) => () => {
    fn(hg);
    fn(mg);
  };
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, CW, CH);
  mg.fillStyle = 'rgb(0,128,0)';
  mg.fillRect(0, 0, CW, CH);
  set(METAL, path((g) => bevelPath(g, 0, 0, CW, CH, 48)));
  if (layout === 'back') {
    set({ h: 0.35, rough: 0.65, metal: 0 }, path((g) => bevelPath(g, 24, 24, CW - 48, CH - 48, 32)));
    set({ h: 0.4, rough: 0.65, metal: 0 }, path((g) => bevelPath(g, 40, 40, CW - 80, CH - 80, 34)));
    set({ h: 0.35, rough: 0.65, metal: 0 }, path((g) => bevelPath(g, 42, 42, CW - 84, CH - 84, 33)));
    const cx = CW / 2;
    const cy = CH / 2;
    set(
      { h: 0.95, rough: 0.3, metal: 0.7 },
      path((g) => {
        g.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (Math.PI / 6) * i + Math.PI / 6;
          const r = i % 2 === 0 ? 150 : 118;
          if (i === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.closePath();
      }),
    );
    set({ h: 0.5, rough: 0.5, metal: 0.3 }, path((g) => hexPath(g, cx, cy, 104)));
    set({ h: 0.75, rough: 0.35, metal: 0.6 }, path((g) => hexPath(g, cx, cy, 90)));
    set({ h: 0.95, rough: 0.3, metal: 0.7 }, path((g) => hexPath(g, cx, cy, 62)));
    const dome = hg.createRadialGradient(cx, cy, 2, cx, cy, 50);
    dome.addColorStop(0, '#fff');
    dome.addColorStop(1, '#a0a0a0');
    set({ h: 1, rough: 0.12, metal: 0.05 }, path((g) => hexPath(g, cx, cy, 50)), dome);
    return;
  }
  const champion = layout.startsWith('hero');
  const minion = layout.endsWith('minion');
  set({ h: 0.4, rough: 0.6, metal: 0 }, path((g) => bevelPath(g, FB, FB, CW - FB * 2, CH - FB * 2, 30)));
  // 六边形暗纹：刻在底板上的细槽
  hg.save();
  bevelPath(hg, FB, FB, CW - FB * 2, CH - FB * 2, 30);
  hg.clip();
  const r = 26;
  const dx = r * Math.sqrt(3);
  hg.lineWidth = 1.5;
  hg.strokeStyle = 'rgb(80,80,80)';
  for (let row = 0, y = 0; y < CH + r; row++, y += r * 1.5) {
    for (let x = row % 2 ? dx / 2 : 0; x < CW + dx; x += dx) {
      hexPath(hg, x, y, r - 2);
      hg.stroke();
    }
  }
  hg.restore();
  // 边框上的槽（英雄卡是嵌线，凸起；非英雄卡是细槽，凹下）
  hg.lineWidth = champion ? 4 : 2;
  hg.strokeStyle = champion ? '#fff' : 'rgb(150,150,150)';
  bevelPath(hg, FB * (champion ? 0.45 : 0.5), FB * (champion ? 0.45 : 0.5), CW - FB * (champion ? 0.9 : 1), CH - FB * (champion ? 0.9 : 1), 40);
  hg.stroke();
  // 原画窗框和原画
  set({ h: 0.8, rough: 0.34, metal: 0.65 }, path((g) => bevelPath(g, ART.x - 9, ART.y - 9, ART.w + 18, ART.h + 18, 30)));
  set({ h: 0.25, rough: 0.6, metal: 0 }, path((g) => bevelPath(g, ART.x, ART.y, ART.w, ART.h, 24)));
  // 横幅：金属包边，中间深色板
  set(METAL, path((g) => bannerPath(g, 0, champion)));
  set({ h: 0.7, rough: 0.45, metal: 0.2 }, path((g) => bannerPath(g, 6, champion)));
  // 文本框：内凹
  set({ h: 0.6, rough: 0.4, metal: 0.3 }, path((g) => bevelPath(g, BOX.x - 3, BOX.y - 3, BOX.w + 6, BOX.h + 6, 18)));
  set({ h: 0.2, rough: 0.75, metal: 0 }, path((g) => bevelPath(g, BOX.x, BOX.y, BOX.w, BOX.h, 16)));
  // 饰钉
  const studs: [number, number, number][] = [];
  if (champion) {
    studs.push(
      [FB * 0.45 + 12, FB * 0.45 + 12, 6],
      [CW - FB * 0.45 - 12, FB * 0.45 + 12, 6],
      [FB * 0.45 + 12, CH - FB * 0.45 - 12, 6],
      [CW - FB * 0.45 - 12, CH - FB * 0.45 - 12, 6],
      [BANNER.x + 13, BANNER.y + BANNER.h / 2, 6],
      [BANNER.x + BANNER.w - 13, BANNER.y + BANNER.h / 2, 6],
    );
    for (const y of [CH * 0.36, CH * 0.62]) studs.push([FB * 0.5, y, 5], [CW - FB * 0.5, y, 5]);
  }
  for (const [x, y, rr] of studs) {
    const dome = hg.createRadialGradient(x, y, 0, x, y, rr);
    dome.addColorStop(0, '#fff');
    dome.addColorStop(1, '#b0b0b0');
    set({ h: 1, rough: 0.3, metal: 0.8 }, path((g) => {
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
    }), dome);
  }
  if (champion) {
    const cx = CW / 2;
    const cy = 30;
    set(
      { h: 1, rough: 0.3, metal: 0.75 },
      path((g) => {
        g.beginPath();
        g.moveTo(cx - 92, cy - 6);
        g.lineTo(cx - 40, cy - 14);
        g.lineTo(cx - 22, cy - 26);
        g.lineTo(cx + 22, cy - 26);
        g.lineTo(cx + 40, cy - 14);
        g.lineTo(cx + 92, cy - 6);
        g.lineTo(cx + 40, cy + 14);
        g.lineTo(cx + 22, cy + 30);
        g.lineTo(cx - 22, cy + 30);
        g.lineTo(cx - 40, cy + 14);
        g.closePath();
      }),
    );
    gemMaps(cx, cy + 2, 17);
  }
  // 宝石：金属外圈，中间是光滑的穹顶
  function gemMaps(cx: number, cy: number, rr: number): void {
    set({ h: 0.95, rough: 0.3, metal: 0.8 }, path((g) => hexPath(g, cx, cy, rr)));
    const dome = hg.createRadialGradient(cx - rr * 0.2, cy - rr * 0.2, 0, cx, cy, rr * 0.8);
    dome.addColorStop(0, '#fff');
    dome.addColorStop(1, '#9a9a9a');
    set({ h: 1, rough: 0.22, metal: 0.05 }, path((g) => hexPath(g, cx, cy, rr * 0.8)), dome);
  }
  gemMaps(COST.x, COST.y, COST.r);
  if (minion) {
    gemMaps(STATS.atk, STATS.y, STATS.r);
    gemMaps(STATS.hp, STATS.y, STATS.r);
  }
}

export type FaceMaps = { normal: THREE.CanvasTexture; rm: THREE.CanvasTexture };
const mapCache = new Map<FaceLayout, FaceMaps>();

// 法线：高度先模糊一点（倒角的斜面），再按左右、上下的差求斜率。canvas 的 y 朝下、贴图的 v 朝上，
// 所以 y 方向的符号和 x 相反
export function cardFaceMaps(layout: FaceLayout): FaceMaps {
  const cached = mapCache.get(layout);
  if (cached) return cached;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = CW;
    c.height = CH;
    return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
  };
  const [hc, hg] = mk();
  const [mc, mg] = mk();
  paintMaps(layout, hg, mg);
  const [bc, bg] = mk();
  bg.filter = 'blur(2px)';
  bg.drawImage(hc, 0, 0);
  const h = bg.getImageData(0, 0, CW, CH).data;
  const out = bg.createImageData(CW, CH);
  const S = 3.2 / 255;
  const at = (x: number, y: number) => h[(Math.min(CH - 1, Math.max(0, y)) * CW + Math.min(CW - 1, Math.max(0, x))) * 4]!;
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * S;
      const ny = (at(x, y + 1) - at(x, y - 1)) * S;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * CW + x) * 4;
      out.data[i] = (nx / l * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  bg.filter = 'none';
  bg.putImageData(out, 0, 0);
  hc.width = hc.height = 0;
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return shared(t);
  };
  const maps = { normal: tex(bc), rm: tex(mc) };
  mapCache.set(layout, maps);
  return maps;
}
