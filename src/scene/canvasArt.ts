// 用 canvas 合成贴图：卡面、卡背、方形头像、文字标签。中文都在 canvas 里画（spec 5.4）。
// 同一张卡的卡面和头像贴图共用一份缓存；头像图稍后才加载好时重画并标记 needsUpdate。
import * as THREE from 'three';
import { findCard, getCard, type CardDef } from '../engine';
import { championOf } from '../assets/manifest';
import { portraitImage } from '../assets/loader';
import { css, fallbackColor, FONT_CN, FONT_NUM, REGION_COLORS } from './theme';
import { shared } from './dispose';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function bevelPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: number): void {
  g.beginPath();
  g.moveTo(x + b, y);
  g.lineTo(x + w - b, y);
  g.lineTo(x + w, y + b);
  g.lineTo(x + w, y + h - b);
  g.lineTo(x + w - b, y + h);
  g.lineTo(x + b, y + h);
  g.lineTo(x, y + h - b);
  g.lineTo(x, y + b);
  g.closePath();
}

function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

function strokeText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, font = FONT_CN, stroke = 0.14): void {
  g.font = `900 ${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(3, size * stroke);
  g.strokeStyle = '#000';
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

// 按宽度折行（中文逐字折）
function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (g.measureText(line + ch).width > width && line) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

// 方形头像：图或纯色加名字前两个字
function drawPortrait(g: CanvasRenderingContext2D, def: CardDef | null, key: string | null, x: number, y: number, s: number, img: HTMLImageElement | null): void {
  if (img) {
    g.drawImage(img, x, y, s, s);
    return;
  }
  g.fillStyle = css(fallbackColor(def?.id ?? key ?? '?'));
  g.fillRect(x, y, s, s);
  const name = def ? def.name : key ?? '?';
  strokeText(g, name.slice(0, 2), x + s / 2, y + s / 2, s * 0.32, '#fff', FONT_CN, 0.08);
}

// ---------- 卡面 ----------

const CW = 512;
const CH = 716;
const faceCache = new Map<string, THREE.CanvasTexture>();

function paintFace(g: CanvasRenderingContext2D, def: CardDef, img: HTMLImageElement | null): void {
  const col = REGION_COLORS[def.class];
  const champion = !!def.champion;
  g.clearRect(0, 0, CW, CH);
  bevelPath(g, 0, 0, CW, CH, 48);
  g.fillStyle = css(col.frame);
  g.fill();
  bevelPath(g, 16, 16, CW - 32, CH - 32, 38);
  g.fillStyle = css(col.inner);
  g.fill();
  if (champion) {
    // 英雄卡的纹饰边：内圈再描一道、四角加菱形
    bevelPath(g, 28, 28, CW - 56, CH - 56, 30);
    g.lineWidth = 5;
    g.strokeStyle = css(col.accent);
    g.stroke();
    g.fillStyle = css(col.accent);
    for (const [x, y] of [[CW / 2, 22], [CW / 2, CH - 22]]) {
      g.beginPath();
      g.moveTo(x, y - 14);
      g.lineTo(x + 22, y);
      g.lineTo(x, y + 14);
      g.lineTo(x - 22, y);
      g.closePath();
      g.fill();
    }
  }
  // 原画窗口
  const ax = 66;
  const ay = 62;
  const as = CW - 132;
  g.save();
  bevelPath(g, ax, ay, as, as * 0.86, 24);
  g.clip();
  drawPortrait(g, def, def.champion ?? null, ax, ay - as * 0.07, as, img);
  g.restore();
  bevelPath(g, ax, ay, as, as * 0.86, 24);
  g.lineWidth = 6;
  g.strokeStyle = css(col.accent);
  g.stroke();
  // 名字横幅
  const by = ay + as * 0.86 + 10;
  g.fillStyle = 'rgba(0,0,0,0.62)';
  g.fillRect(30, by, CW - 60, 66);
  g.fillStyle = css(col.accent);
  g.fillRect(30, by, CW - 60, 4);
  g.fillRect(30, by + 62, CW - 60, 4);
  strokeText(g, def.name, CW / 2, by + 34, def.name.length > 6 ? 40 : 48, '#f4f0e6');
  // 文本框
  g.font = `700 30px ${FONT_CN}`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillStyle = def.class === 'demacia' ? '#2a2418' : '#ece6d4';
  const lines = wrap(g, def.text, CW - 120).slice(0, 4);
  lines.forEach((l, i) => g.fillText(l, CW / 2, by + 84 + i * 38));
  // 费用六边形
  hexPath(g, 70, 70, 54);
  g.fillStyle = '#2f8cff';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#c8aa6e';
  g.stroke();
  strokeText(g, String(def.cost), 70, 74, 64, '#fff', FONT_NUM);
  if (def.type === 'minion') {
    for (const [x, fill, value] of [
      [72, '#d9a024', def.attack ?? 0],
      [CW - 72, '#c8302c', def.health ?? 0],
    ] as const) {
      g.beginPath();
      g.arc(x, CH - 72, 50, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 7;
      g.strokeStyle = '#1a1208';
      g.stroke();
      strokeText(g, String(value), x, CH - 68, 62, '#fff', FONT_NUM);
    }
  }
}

export function cardFaceTexture(cardId: string): THREE.CanvasTexture {
  const cached = faceCache.get(cardId);
  if (cached) return cached;
  const def = getCard(cardId);
  const [c, g] = makeCanvas(CW, CH);
  const champ = championOf(cardId);
  const img = champ ? portraitImage(champ, (i) => {
    paintFace(g, def, i);
    tex.needsUpdate = true;
  }) : null;
  paintFace(g, def, img);
  const tex = shared(toTexture(c));
  faceCache.set(cardId, tex);
  return tex;
}

let backTex: THREE.CanvasTexture | null = null;
export function cardBackTexture(): THREE.CanvasTexture {
  if (backTex) return backTex;
  const [c, g] = makeCanvas(CW, CH);
  bevelPath(g, 0, 0, CW, CH, 48);
  g.fillStyle = '#1b2440';
  g.fill();
  g.lineWidth = 14;
  g.strokeStyle = '#c8aa6e';
  g.stroke();
  bevelPath(g, 44, 44, CW - 88, CH - 88, 30);
  g.lineWidth = 5;
  g.strokeStyle = '#3a6fb0';
  g.stroke();
  g.beginPath();
  g.moveTo(CW / 2, CH / 2 - 150);
  g.lineTo(CW / 2 + 100, CH / 2);
  g.lineTo(CW / 2, CH / 2 + 150);
  g.lineTo(CW / 2 - 100, CH / 2);
  g.closePath();
  g.fillStyle = '#3a6fb0';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#c8aa6e';
  g.stroke();
  g.beginPath();
  g.arc(CW / 2, CH / 2, 28, 0, Math.PI * 2);
  g.fillStyle = '#c8aa6e';
  g.fill();
  backTex = shared(toTexture(c));
  return backTex;
}

// ---------- 方形头像 ----------

const portraitCache = new Map<string, THREE.CanvasTexture>();

// cardId 为卡牌 id；championKey 直接给英雄 key 时（职业英雄）用它。
export function portraitTexture(cardId: string, championKey: string | null = championOf(cardId)): THREE.CanvasTexture {
  const key = `${cardId}|${championKey ?? ''}`;
  const cached = portraitCache.get(key);
  if (cached) return cached;
  const [c, g] = makeCanvas(256, 256);
  const def = findCard(cardId) ?? null;
  const img = championKey
    ? portraitImage(championKey, (i) => {
        drawPortrait(g, def, championKey, 0, 0, 256, i);
        tex.needsUpdate = true;
      })
    : null;
  drawPortrait(g, def, championKey, 0, 0, 256, img);
  const tex = shared(toTexture(c));
  portraitCache.set(key, tex);
  return tex;
}

// ---------- 文字标签（sprite 用） ----------

export type Label = { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; texture: THREE.CanvasTexture };

export function makeLabelCanvas(w: number, h: number): Label {
  const [canvas, g] = makeCanvas(w, h);
  return { canvas, g, texture: toTexture(canvas) };
}

export { strokeText, hexPath, bevelPath };
