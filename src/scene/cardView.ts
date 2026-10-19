// 手牌、展示中的牌：海克斯风格的棱角边框（占位版），费用六边形在左上角，名字横幅，原画窗口，文本框，
// 随从底部左右是攻击和生命。看不到的牌显示卡背。
import { Container, Graphics, Text } from 'pixi.js';
import { getCard, HIDDEN_CARD_ID } from '../engine';
import { CARD_H, CARD_W } from '../presentation/layout';
import { glowFilter } from '../presentation/fx/filters';
import { Portrait } from './portrait';
import { COLORS, FONT_CN, FONT_NUM, REGION_COLORS } from './theme';
import { dispose } from './dispose';

const W = CARD_W;
const H = CARD_H;
const BEVEL = 14;

function bevelRect(g: Graphics, w: number, h: number, b: number): Graphics {
  const x = -w / 2;
  const y = -h / 2;
  return g.poly([x + b, y, x + w - b, y, x + w, y + b, x + w, y + h - b, x + w - b, y + h, x + b, y + h, x, y + h - b, x, y + b]);
}

function hexagon(g: Graphics, r: number): Graphics {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return g.poly(pts);
}

function label(text: string, size: number, fill: number, font = FONT_CN, stroke = 0x000000): Text {
  const t = new Text({
    text,
    style: { fontFamily: font, fontSize: size, fill, fontWeight: '700', stroke: { color: stroke, width: Math.max(2, size / 7) } },
  });
  t.anchor.set(0.5);
  t.resolution = 2;
  return t;
}

export class CardView extends Container {
  instanceId: number;
  cardId = '';
  private face = new Container();
  private back = new Container();
  private highlight = new Graphics();
  private dim = new Graphics();
  private mark = new Container();
  private highlighted = false;

  constructor(instanceId: number, cardId: string) {
    super();
    this.instanceId = instanceId;
    bevelRect(this.highlight, W + 10, H + 10, BEVEL + 3).stroke({ width: 5, color: COLORS.playable });
    this.highlight.visible = false;
    this.highlight.filters = [glowFilter(COLORS.playable)];
    bevelRect(this.dim, W, H, BEVEL).fill({ color: 0x000000, alpha: 0.45 });
    this.dim.visible = false;
    this.buildBack();
    this.buildMark();
    this.addChild(this.highlight, this.face, this.back, this.dim, this.mark);
    this.setCard(cardId);
  }

  get hidden(): boolean {
    return this.cardId === HIDDEN_CARD_ID;
  }

  setCard(cardId: string): void {
    if (cardId === this.cardId) return;
    this.cardId = cardId;
    this.face.removeChildren().forEach((c) => dispose(c));
    if (cardId === HIDDEN_CARD_ID) {
      this.face.visible = false;
      this.back.visible = true;
      return;
    }
    this.face.visible = true;
    this.back.visible = false;
    this.buildFace(cardId);
  }

  setHighlight(on: boolean): void {
    if (on === this.highlighted) return;
    this.highlighted = on;
    this.highlight.visible = on;
  }

  setDim(on: boolean): void {
    this.dim.visible = on;
  }

  setMarked(on: boolean): void {
    this.mark.visible = on;
  }

  private buildBack(): void {
    const g = new Graphics();
    bevelRect(g, W, H, BEVEL).fill(COLORS.cardBack).stroke({ width: 4, color: COLORS.hexGold });
    bevelRect(g, W - 26, H - 26, BEVEL - 4).stroke({ width: 2, color: COLORS.cardBackAccent });
    g.poly([0, -50, 34, 0, 0, 50, -34, 0]).fill({ color: COLORS.cardBackAccent, alpha: 0.8 }).stroke({ width: 3, color: COLORS.hexGold });
    g.circle(0, 0, 10).fill(COLORS.hexGold);
    this.back.addChild(g);
  }

  private buildMark(): void {
    const g = new Graphics();
    g.circle(0, -30, 38).fill({ color: 0x000000, alpha: 0.55 });
    g.moveTo(-22, -52).lineTo(22, -8).moveTo(22, -52).lineTo(-22, -8).stroke({ width: 9, color: 0xff4040, cap: 'round' });
    this.mark.addChild(g);
    this.mark.visible = false;
  }

  private buildFace(cardId: string): void {
    const def = getCard(cardId);
    const colors = REGION_COLORS[def.class];
    const isChampion = !!def.champion;
    const frame = new Graphics();
    bevelRect(frame, W, H, BEVEL).fill(colors.frame);
    bevelRect(frame, W - 10, H - 10, BEVEL - 3).fill(colors.inner);
    if (isChampion) bevelRect(frame, W - 18, H - 18, BEVEL - 5).stroke({ width: 2, color: colors.accent });
    this.face.addChild(frame);

    const art = new Portrait(isChampion ? 104 : 96);
    art.show(cardId);
    art.y = -40;
    const artFrame = new Graphics().rect(-54, -94, 108, 108).stroke({ width: 3, color: colors.accent });
    this.face.addChild(art, artFrame);

    const banner = new Graphics().rect(-W / 2 + 6, 14, W - 12, 26).fill({ color: 0x000000, alpha: 0.55 });
    const name = label(def.name, def.name.length > 6 ? 14 : 17, COLORS.textLight);
    name.y = 27;
    this.face.addChild(banner, name);

    const text = new Text({
      text: def.text,
      style: {
        fontFamily: FONT_CN,
        fontSize: def.text.length > 22 ? 11 : 13,
        fill: def.class === 'demacia' ? 0x2a2418 : 0xe8e2d0,
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: W - 24,
        align: 'center',
        lineHeight: def.text.length > 22 ? 13 : 16,
      },
    });
    text.anchor.set(0.5, 0);
    text.y = 46;
    text.resolution = 2;
    this.face.addChild(text);

    const cost = hexagon(new Graphics(), 20).fill(COLORS.mana).stroke({ width: 3, color: COLORS.hexGold });
    cost.position.set(-W / 2 + 14, -H / 2 + 14);
    const costText = label(String(def.cost), 22, 0xffffff, FONT_NUM);
    costText.position.copyFrom(cost.position);
    this.face.addChild(cost, costText);

    if (def.type === 'minion') {
      const atk = new Graphics().circle(0, 0, 18).fill(0xd9a024).stroke({ width: 3, color: 0x3a2a08 });
      atk.position.set(-W / 2 + 14, H / 2 - 14);
      const atkText = label(String(def.attack ?? 0), 20, 0xffffff, FONT_NUM);
      atkText.position.copyFrom(atk.position);
      const hp = new Graphics().circle(0, 0, 18).fill(0xc8302c).stroke({ width: 3, color: 0x3a0808 });
      hp.position.set(W / 2 - 14, H / 2 - 14);
      const hpText = label(String(def.health ?? 0), 20, 0xffffff, FONT_NUM);
      hpText.position.copyFrom(hp.position);
      this.face.addChild(atk, atkText, hp, hpText);
    }
  }
}
