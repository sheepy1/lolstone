// 方形头像：有抓取的头像图就用图，没有就用纯色加名字首字兜底。头像图按需加载，加载好后自动换上。
import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { findCard } from '../engine';
import { championOf } from '../assets/manifest';
import { portraitTexture } from '../assets/loader';
import { fallbackColor, FONT_CN } from './theme';

export class Portrait extends Container {
  private sprite: Sprite | null = null;
  private fallback: Container | null = null;
  private cardId = '';

  constructor(private readonly size: number) {
    super();
  }

  // 显示某张卡的英雄头像。champion 直接给英雄 key 时（职业英雄）不查卡。
  show(cardId: string, champion: string | null = championOf(cardId)): void {
    const key = `${cardId}|${champion ?? ''}`;
    if (key === this.cardId) return;
    this.cardId = key;
    this.removeChildren().forEach((c) => c.destroy());
    this.sprite = null;
    this.fallback = null;
    const tex = champion ? portraitTexture(champion, (t) => this.cardId === key && this.useTexture(t)) : null;
    if (tex) this.useTexture(tex);
    else this.useFallback(cardId, champion);
  }

  private useTexture(tex: Texture): void {
    this.fallback?.destroy({ children: true });
    this.fallback = null;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.width = this.size;
    s.height = this.size;
    this.sprite = s;
    this.addChild(s);
  }

  private useFallback(cardId: string, champion: string | null): void {
    const c = new Container();
    const g = new Graphics().rect(-this.size / 2, -this.size / 2, this.size, this.size).fill(fallbackColor(cardId));
    c.addChild(g);
    const name = findCard(cardId)?.name ?? champion ?? '?';
    const t = new Text({
      text: name.slice(0, 2),
      style: { fontFamily: FONT_CN, fontSize: this.size * 0.34, fill: 0xffffff, fontWeight: '700' },
    });
    t.anchor.set(0.5);
    t.resolution = 2;
    c.addChild(t);
    this.fallback = c;
    this.addChild(c);
  }
}
