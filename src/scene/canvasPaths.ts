// canvas 上常用的路径：切角矩形、六边形。卡面底图、卡背、英雄技能、徽章都用。

export function bevelPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: number): void {
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

export function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
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
