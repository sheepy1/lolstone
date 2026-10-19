// 用 canvas 合成贴图：卡面底图（边框、原画、费用六边形、名字横幅、文本框）、卡背、方形头像、文字标签。
// 卡面上的文字不在这里画，由 cardText.ts 用 SDF 文本叠上去（spec 5.4）。
// 同一张卡的卡面和头像贴图共用一份缓存；图稍后才加载好时重画并标记 needsUpdate。
// 用哪张图（spec 5.4、5.9）：
// - 卡面原画窗口：英雄卡用竖版原画（loading.jpg）；其余卡用 card-art.json 的 art，按 crop 裁。
// - 方形头像（场上随从、枢纽）：英雄用 Data Dragon 头像；其余用 card-art.json 的 icon，没有 icon 的从 art 裁出方形。
// 图没加载好或缺失时退一级（原画 → 方图 → 纯色加名字），都没有就是纯色加名字前两个字，不报错。
import * as THREE from 'three';
import { allHeroClasses, findCard, getCard, getHeroClass, type CardDef, type HeroClass } from '../engine';
import { cardArtOf, heroPowerIconUrl, keywordIconUrl, type ArtCrop } from '../assets/cardArt';
import { championOf, iconUrl, loadingArtUrl } from '../assets/manifest';
import { artImage, type ArtImage } from '../assets/loader';
import { drawCropped, enhanceUpscaled, UPSCALE_SOFT } from './artDraw';
import { css, fallbackColor, FONT_CN, FONT_NUM, REGION_COLORS } from './theme';
import { shared } from './dispose';
import { bevelPath, hexPath } from './canvasPaths';
import { ART_STYLE } from './artStyle';
import { paintBackLegacy, paintFaceLegacy } from './canvasArtLegacy';
import { paintCardBack, paintCardFace } from './cardFrameArt';

// 竖版原画（308×560）里英雄的脸大多在上面三分之一，原画窗口取上部
const LOADING_CROP: ArtCrop = { focus: [0.5, 0.2], zoom: 1 };
const SQUARE_WHOLE: ArtCrop = { focus: [0.5, 0.5], zoom: 1 };

type Pick = { img: ArtImage; crop: ArtCrop } | null;

// 按顺序取第一张已经加载好的图；还在加载的，加载好后调 onReady 重画（先到的那张也会触发，重画时会再按顺序挑）。
function firstImage(candidates: readonly { url: string | null; crop: ArtCrop }[], onReady: () => void): Pick {
  for (const c of candidates) {
    if (!c.url) continue;
    const img = artImage(c.url, onReady);
    if (img) return { img, crop: c.crop };
  }
  return null;
}

// 卡面原画窗口的候选图，从好到差
function faceCandidates(def: CardDef): { url: string | null; crop: ArtCrop }[] {
  if (def.champion) {
    return [
      { url: loadingArtUrl(def.champion), crop: LOADING_CROP },
      { url: iconUrl(def.champion), crop: SQUARE_WHOLE },
    ];
  }
  const a = cardArtOf(def.id);
  if (!a) {
    // 英雄技能（悬停大卡）：用技能图标
    const cls = allHeroClasses().find((c) => c.heroPower === def.id);
    return cls ? [{ url: heroPowerIconUrl(cls.id), crop: SQUARE_WHOLE }] : [];
  }
  return [
    { url: a.art, crop: a.crop },
    { url: a.icon, crop: SQUARE_WHOLE },
  ];
}

// 方形头像的候选图
function portraitCandidates(cardId: string, championKey: string | null): { url: string | null; crop: ArtCrop }[] {
  if (championKey) return [{ url: iconUrl(championKey), crop: SQUARE_WHOLE }];
  const a = cardArtOf(cardId);
  if (!a) return [];
  return [
    { url: a.icon, crop: SQUARE_WHOLE },
    { url: a.art, crop: a.crop },
  ];
}

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

// 纯色加名字前两个字（没有图时的兜底）
function drawFallback(g: CanvasRenderingContext2D, def: CardDef | null, key: string | null, x: number, y: number, w: number, h: number): void {
  g.fillStyle = css(fallbackColor(def?.id ?? key ?? '?'));
  g.fillRect(x, y, w, h);
  const name = def ? def.name : key ?? '?';
  strokeText(g, name.slice(0, 2), x + w / 2, y + h / 2, Math.min(w, h) * 0.32, '#fff', FONT_CN, 0.08);
}

// 方形头像：图按裁切铺满，或纯色兜底
function drawPortrait(g: CanvasRenderingContext2D, def: CardDef | null, key: string | null, x: number, y: number, s: number, pick: Pick): void {
  if (pick) drawCropped(g, pick.img, pick.crop, x, y, s, s);
  else drawFallback(g, def, key, x, y, s, s);
}

// ---------- 卡面 ----------

const CW = 512;
const CH = 716;
const faceCache = new Map<string, THREE.CanvasTexture>();

export function cardFaceTexture(cardId: string): THREE.CanvasTexture {
  const cached = faceCache.get(cardId);
  if (cached) return cached;
  const def = getCard(cardId);
  const [c, g] = makeCanvas(CW, CH);
  const candidates = faceCandidates(def);
  const paint = ART_STYLE === 'old' ? paintFaceLegacy : paintCardFace;
  // 原画窗口里画什么：图按裁切铺满（小图放大时做增强），没有图时纯色加名字。画框的函数先裁好窗口再调它
  const draw = (pick: Pick) => (x: number, y: number, w: number, h: number) => {
    if (pick) {
      if (drawCropped(g, pick.img, pick.crop, x, y, w, h) > UPSCALE_SOFT) enhanceUpscaled(g, x, y, w, h);
    } else drawFallback(g, def, def.champion ?? null, x, y, w, h);
  };
  const repaint = () => {
    paint(g, def, draw(firstImage(candidates, repaint)));
    tex.needsUpdate = true;
  };
  paint(g, def, draw(firstImage(candidates, repaint)));
  const tex = shared(toTexture(c));
  faceCache.set(cardId, tex);
  return tex;
}

let backTex: THREE.CanvasTexture | null = null;
export function cardBackTexture(): THREE.CanvasTexture {
  if (backTex) return backTex;
  const [c, g] = makeCanvas(CW, CH);
  (ART_STYLE === 'old' ? paintBackLegacy : paintCardBack)(g);
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
  const candidates = portraitCandidates(cardId, championKey);
  const repaint = () => {
    drawPortrait(g, def, championKey, 0, 0, 256, firstImage(candidates, repaint));
    tex.needsUpdate = true;
  };
  drawPortrait(g, def, championKey, 0, 0, 256, firstImage(candidates, repaint));
  const tex = shared(toTexture(c));
  portraitCache.set(key, tex);
  return tex;
}

// ---------- 英雄技能按钮 ----------

const powerCache = new Map<HeroClass, THREE.CanvasTexture>();

// 英雄技能按钮的顶面（六边形）：技能图标嵌在六边形里，上方蓝色圆片是费用。没有图标时写技能名。
export function heroPowerTexture(cls: HeroClass): THREE.CanvasTexture {
  const cached = powerCache.get(cls);
  if (cached) return cached;
  const def = getCard(getHeroClass(cls).heroPower);
  const col = REGION_COLORS[cls];
  const [c, g] = makeCanvas(256, 256);
  const url = heroPowerIconUrl(cls);
  const paint = (img: ArtImage | null) => {
    g.clearRect(0, 0, 256, 256);
    hexPath(g, 128, 128, 124);
    g.fillStyle = css(col.inner);
    g.fill();
    if (img) {
      g.save();
      hexPath(g, 128, 128, 100);
      g.clip();
      // 64×64 的技能图标铺满内六边形（外接方形 200），放大三倍，按小图放大处理
      drawCropped(g, img, SQUARE_WHOLE, 28, 28, 200, 200);
      g.restore();
    } else {
      // 名字长的（诺克萨斯断头台）缩小字号，放得进六边形
      strokeText(g, def.name, 128, 140, def.name.length > 3 ? Math.floor(190 / def.name.length) : 64, '#ffffff', FONT_CN, 0.12);
    }
    hexPath(g, 128, 128, 100);
    g.lineWidth = 8;
    g.strokeStyle = css(col.accent);
    g.stroke();
    g.beginPath();
    g.arc(128, 48, 30, 0, Math.PI * 2);
    g.fillStyle = '#2f8cff';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#c8aa6e';
    g.stroke();
    strokeText(g, String(def.cost), 128, 50, 40, '#fff', FONT_NUM);
  };
  paint(
    url
      ? artImage(url, (i) => {
          paint(i);
          tex.needsUpdate = true;
        })
      : null,
  );
  const tex = shared(toTexture(c));
  powerCache.set(cls, tex);
  return tex;
}

// ---------- 关键词小图标 ----------

/**
 * 在 (x, y, w, h) 画关键词的 LoL 图标（圆角方形裁切）。图还没加载好或缺失时返回 false，调用方画自己的兜底；
 * 稍后加载好时调 onReady。
 */
export function drawKeywordIcon(
  g: CanvasRenderingContext2D,
  keyword: string,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  onReady: () => void,
): boolean {
  const url = keywordIconUrl(keyword);
  const img = url ? artImage(url, onReady) : null;
  if (!img) return false;
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.clip();
  drawCropped(g, img, SQUARE_WHOLE, x, y, w, h);
  g.restore();
  return true;
}

// ---------- 文字标签（sprite 用） ----------

export type Label = { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; texture: THREE.CanvasTexture };

export function makeLabelCanvas(w: number, h: number): Label {
  const [canvas, g] = makeCanvas(w, h);
  return { canvas, g, texture: toTexture(canvas) };
}

export { strokeText, hexPath, bevelPath };
export { CW as CARD_CANVAS_W, CH as CARD_CANVAS_H };
