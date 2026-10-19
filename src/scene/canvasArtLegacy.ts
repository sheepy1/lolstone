// 旧版卡面底图和卡背（M3 骨架）：平涂的边框、费用六边形、名字横幅、文本框，深蓝底加金色菱形的卡背。
// 留着给 /dev/fx 的美术面板做新旧对比（?art=old），对局默认用 cardFrameArt.ts。
import type { CardDef } from '../engine';
import { bevelPath, hexPath } from './canvasPaths';
import { css, REGION_COLORS } from './theme';

const CW = 512;
const CH = 716;

/** 把原画画进 (x, y, w, h)；调用前已经裁好窗口。 */
export type DrawArt = (x: number, y: number, w: number, h: number) => void;

export function paintFaceLegacy(g: CanvasRenderingContext2D, def: CardDef, drawArt: DrawArt): void {
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
  const ah = as * 0.86;
  g.save();
  bevelPath(g, ax, ay, as, ah, 24);
  g.clip();
  drawArt(ax, ay, as, ah);
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
  // 文本框（文字由 cardText.ts 用 SDF 文本叠在上面，不烧进贴图）
  g.fillStyle = def.class === 'demacia' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
  g.fillRect(48, by + 76, CW - 96, CH - by - 76 - 60);
  // 费用六边形
  hexPath(g, 70, 70, 54);
  g.fillStyle = '#2f8cff';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#c8aa6e';
  g.stroke();
  if (def.type === 'minion') {
    for (const [x, fill] of [
      [72, '#d9a024'],
      [CW - 72, '#c8302c'],
    ] as const) {
      g.beginPath();
      g.arc(x, CH - 72, 50, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 7;
      g.strokeStyle = '#1a1208';
      g.stroke();
    }
  }
}

export function paintBackLegacy(g: CanvasRenderingContext2D): void {
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
}
