// 目标箭头（spec 5.3）：从来源拉出一条红色曲线箭头跟着鼠标。攻击箭头和选目标箭头共用，颜色可换。
import { Container, Graphics } from 'pixi.js';

export type Point = { x: number; y: number };

export class TargetArrow extends Container {
  private g = new Graphics();
  private from: Point = { x: 0, y: 0 };
  private color = 0xff3b3b;

  constructor() {
    super();
    this.addChild(this.g);
    this.visible = false;
    this.eventMode = 'none';
  }

  start(from: Point, color = 0xff3b3b): void {
    this.from = { ...from };
    this.color = color;
    this.visible = true;
    this.update(from);
  }

  // 箭头指向 to，onTarget 为 true 时箭头头部画准星。
  update(to: Point, onTarget = false): void {
    if (!this.visible) return;
    const g = this.g.clear();
    const { x: x0, y: y0 } = this.from;
    const dx = to.x - x0;
    const dy = to.y - y0;
    const len = Math.hypot(dx, dy);
    if (len < 4) return;
    // 控制点往上抬，箭身成弧
    const cx = x0 + dx / 2 - dy * 0.15;
    const cy = y0 + dy / 2 - Math.abs(dx) * 0.15 - 60;
    // 箭身用一串圆点画，越靠近头部越大
    const n = Math.max(6, Math.floor(len / 26));
    for (let i = 0; i <= n - 1; i++) {
      const t = i / n;
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * to.x;
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * to.y;
      g.circle(x, y, 4 + t * 6).fill({ color: this.color, alpha: 0.55 + t * 0.4 });
    }
    // 箭头方向取曲线末端切线
    const tx = to.x - cx;
    const ty = to.y - cy;
    const a = Math.atan2(ty, tx);
    const head = 34;
    const p1 = { x: to.x - Math.cos(a - 0.45) * head, y: to.y - Math.sin(a - 0.45) * head };
    const p2 = { x: to.x - Math.cos(a + 0.45) * head, y: to.y - Math.sin(a + 0.45) * head };
    g.poly([to.x, to.y, p1.x, p1.y, p2.x, p2.y]).fill(this.color).stroke({ width: 3, color: 0x400000 });
    if (onTarget) {
      g.circle(to.x, to.y, 46).stroke({ width: 5, color: this.color });
      g.moveTo(to.x - 60, to.y).lineTo(to.x - 30, to.y).moveTo(to.x + 30, to.y).lineTo(to.x + 60, to.y);
      g.moveTo(to.x, to.y - 60).lineTo(to.x, to.y - 30).moveTo(to.x, to.y + 30).lineTo(to.x, to.y + 60);
      g.stroke({ width: 4, color: this.color });
    }
  }

  stop(): void {
    this.visible = false;
    this.g.clear();
  }
}
