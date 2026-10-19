// 把配图按裁切画进卡面原画窗口、方形头像（spec 5.9）。
// 裁切算法和 scripts/art-review.ts 对照页的 CSS 一致，用户在对照页里看到的取景就是游戏里的取景：
//   object-fit: cover; object-position: focus; transform-origin: focus; transform: scale(zoom)
// 128 像素的峡谷头像放进 380 像素宽的窗口要放大三倍，直接画偏糊，按 enhanceUpscaled 处理。
import type { ArtCrop } from '../assets/cardArt';

export type Rect = { x: number; y: number; w: number; h: number };

/** 窗口 w×h 用 iw×ih 的图按 crop 取景时，对应原图里的哪一块。 */
export function cropSource(iw: number, ih: number, w: number, h: number, crop: ArtCrop): Rect {
  const s = Math.max(w / iw, h / ih); // cover
  const z = Math.max(1, crop.zoom);
  const [px, py] = crop.focus;
  // object-position：图在窗口里的偏移（铺满后多出来的部分按 focus 比例分到两边）
  const ox = px * (w - iw * s);
  const oy = py * (h - ih * s);
  // 以窗口里 focus 那一点为中心放大 zoom 倍：窗口左上角对应放大前的 (px·w·(1 − 1/z), py·h·(1 − 1/z))
  const x = (px * w * (1 - 1 / z) - ox) / s;
  const y = (py * h * (1 - 1 / z) - oy) / s;
  return { x, y, w: w / (s * z), h: h / (s * z) };
}

type Img = CanvasImageSource & { width: number; height: number };

const size = (img: Img): [number, number] =>
  img instanceof HTMLImageElement ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height];

/**
 * 把 img 按 crop 画进 (x, y, w, h)。返回放大倍数（窗口像素 / 原图像素），大于 UPSCALE_SOFT 时调用方应该做
 * enhanceUpscaled。
 */
export function drawCropped(g: CanvasRenderingContext2D, img: Img, crop: ArtCrop, x: number, y: number, w: number, h: number): number {
  const [iw, ih] = size(img);
  const r = cropSource(iw, ih, w, h, crop);
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const scale = w / r.w;
  if (scale > UPSCALE_SOFT) {
    // 小图先在离屏 canvas 上分两步放大（每步不超过 2 倍），比一步放大三倍的双线性插值少一些方块感和锯齿
    g.drawImage(stepUpscale(img, r, scale), x, y, w, h);
  } else {
    g.drawImage(img, r.x, r.y, r.w, r.h, x, y, w, h);
  }
  g.restore();
  return scale;
}

/** 放大超过这个倍数的图算"小图放大"，要做 enhanceUpscaled。 */
export const UPSCALE_SOFT = 2;

function stepUpscale(img: Img, r: Rect, scale: number): HTMLCanvasElement {
  let src: CanvasImageSource = img;
  let sx = r.x;
  let sy = r.y;
  let sw = r.w;
  let sh = r.h;
  let k = 1;
  let out: HTMLCanvasElement | null = null;
  while (k < scale) {
    const step = Math.min(2, scale / k);
    k *= step;
    const c = document.createElement('canvas');
    c.width = Math.round(r.w * k);
    c.height = Math.round(r.h * k);
    const cg = c.getContext('2d')!;
    cg.imageSmoothingEnabled = true;
    cg.imageSmoothingQuality = 'high';
    cg.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    src = c;
    sx = 0;
    sy = 0;
    sw = c.width;
    sh = c.height;
    out = c;
  }
  sharpen(out!, 0.35);
  return out!;
}

/** 轻微的反锐化（3×3 拉普拉斯），把放大后发虚的边缘提一点，amount 0 到 1。 */
function sharpen(c: HTMLCanvasElement, amount: number): void {
  const g = c.getContext('2d')!;
  const { width: w, height: h } = c;
  const src = g.getImageData(0, 0, w, h);
  const out = g.createImageData(w, h);
  const a = src.data;
  const o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const up = (Math.max(0, y - 1) * w + x) * 4;
      const dn = (Math.min(h - 1, y + 1) * w + x) * 4;
      const lf = (y * w + Math.max(0, x - 1)) * 4;
      const rt = (y * w + Math.min(w - 1, x + 1)) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v = a[i + ch] * (1 + 4 * amount) - amount * (a[up + ch] + a[dn + ch] + a[lf + ch] + a[rt + ch]);
        o[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      o[i + 3] = a[i + 3];
    }
  }
  g.putImageData(out, 0, 0);
}

/**
 * 小图放大后的修饰：四周压一圈暗角，把视线收到画面中心，糊的边缘不那么显眼（窗口外沿本来就有一道金属色描边）；
 * 再叠一层很淡的颗粒，盖住插值出来的平滑色块。调用前 g 已经按窗口形状 clip 好。
 */
export function enhanceUpscaled(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  const cx = x + w / 2;
  const cy = y + h / 2;
  const v = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.32, cx, cy, Math.hypot(w, h) * 0.56);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v;
  g.fillRect(x, y, w, h);
  g.globalAlpha = 0.07;
  g.drawImage(grain(), x, y, w, h);
  g.restore();
}

let grainCanvas: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const d = g.createImageData(256, 256);
  // 固定种子的伪随机，每次生成同一张颗粒
  let s = 12345;
  for (let i = 0; i < d.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = s & 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  grainCanvas = c;
  return c;
}
