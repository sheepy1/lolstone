// 卡面文字（spec 5.4、6.1）：费用、名字、文本、攻击、生命用 troika-three-text 的 SDF 文本，叠在卡面底图上，
// 透视缩小、放大都清晰。字体是按卡池用到的字做的子集（public/fonts，生成方法见 NOTES「M3 表现层」）。
// 坐标是卡牌本地坐标（卡牌中心为原点，宽 CARD_W、高 CARD_H），和 canvasArt.ts 里卡面底图的版式一一对应。
import { preloadFont, Text } from 'troika-three-text';
import { getCard, type CardDef } from '../engine';
import { cardFontUrl } from '../assets/manifest';
import { CARD_H, CARD_T, CARD_W } from '../presentation/layout';
import { COLORS } from './theme';

// 卡面底图是 512×716 的 canvas，这里把它的像素坐标换成卡牌本地坐标
const PX = CARD_W / 512;
const at = (px: number, py: number): [number, number] => [-CARD_W / 2 + px * PX, CARD_H / 2 - py * PX];

const Z = CARD_T / 2 + 0.004;

type Slot = 'cost' | 'name' | 'body' | 'attack' | 'health';

function make(): Text {
  const t = new Text();
  t.font = cardFontUrl();
  t.anchorX = 'center';
  t.anchorY = 'middle';
  t.outlineColor = 0x000000;
  t.castShadow = false;
  t.position.z = Z;
  return t;
}

export type CardStats = { attack: number; health: number; maxHealth: number };

export class CardTexts {
  private readonly texts: Record<Slot, Text>;
  private dimmed = false;
  private def: CardDef | null = null;

  constructor(private readonly parent: { add(...o: Text[]): unknown }) {
    const cost = make();
    [cost.position.x, cost.position.y] = at(70, 76);
    cost.fontSize = 0.2;
    cost.outlineWidth = '10%';
    const name = make();
    [name.position.x, name.position.y] = at(256, 433);
    name.outlineWidth = '7%';
    name.maxWidth = 1.3;
    const body = make();
    [body.position.x, body.position.y] = at(256, 488);
    body.anchorY = 'top';
    body.fontSize = 0.088;
    body.maxWidth = 1.22;
    body.textAlign = 'center';
    body.lineHeight = 1.3;
    const attack = make();
    [attack.position.x, attack.position.y] = at(72, 650);
    attack.fontSize = 0.19;
    attack.outlineWidth = '10%';
    const health = make();
    [health.position.x, health.position.y] = at(440, 650);
    health.fontSize = 0.19;
    health.outlineWidth = '10%';
    this.texts = { cost, name, body, attack, health };
    parent.add(cost, name, body, attack, health);
  }

  // 显示一张卡的文字。null 表示看不到的牌（卡背），文字全部隐藏。
  setCard(cardId: string | null): void {
    const t = this.texts;
    if (!cardId) {
      for (const x of Object.values(t)) x.visible = false;
      this.def = null;
      return;
    }
    const def = getCard(cardId);
    this.def = def;
    t.cost.text = String(def.cost);
    t.name.text = def.name;
    // 名字太长时缩小字号，横幅里放得下
    t.name.fontSize = def.name.length > 6 ? 0.12 : 0.14;
    t.body.text = def.text;
    const minion = def.type === 'minion';
    t.attack.text = String(def.attack ?? 0);
    t.health.text = String(def.health ?? 0);
    for (const x of Object.values(t)) x.visible = true;
    t.attack.visible = minion;
    t.health.visible = minion;
    this.applyColors(null);
  }

  // 场上随从的当前数值（悬停大卡用）：增益变绿，减益或受伤变红
  setStats(stats: CardStats | null): void {
    const def = this.def;
    if (!def || def.type !== 'minion') return;
    this.texts.attack.text = String(stats?.attack ?? def.attack ?? 0);
    this.texts.health.text = String(Math.max(0, stats?.health ?? def.health ?? 0));
    this.applyColors(stats);
  }

  // 费用不够的牌变暗
  setDim(on: boolean): void {
    if (on === this.dimmed) return;
    this.dimmed = on;
    this.applyColors(null);
  }

  private applyColors(stats: CardStats | null): void {
    const def = this.def;
    if (!def) return;
    const k = this.dimmed ? 0.5 : 1;
    const shade = (hex: number) => {
      const r = ((hex >> 16) & 255) * k;
      const g = ((hex >> 8) & 255) * k;
      const b = (hex & 255) * k;
      return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    };
    const t = this.texts;
    t.cost.color = shade(0xffffff);
    t.name.color = shade(0xf4f0e6);
    t.body.color = shade(def.class === 'demacia' ? 0x2a2418 : 0xece6d4);
    const baseAtk = def.attack ?? 0;
    const baseHp = def.health ?? 0;
    const atk = stats?.attack ?? baseAtk;
    const up = COLORS.buffed;
    const down = COLORS.debuffed;
    t.attack.color = shade(atk > baseAtk ? up : atk < baseAtk ? down : 0xffffff);
    t.health.color = shade(
      stats && stats.health < stats.maxHealth ? down : stats && stats.maxHealth > baseHp ? up : 0xffffff,
    );
    for (const x of Object.values(t)) x.sync();
  }

  dispose(): void {
    for (const x of Object.values(this.texts)) x.dispose();
  }
}

// 加载页预载字体和本局用到的字，开局时卡面文字不用临时排版
export function preloadCardFont(characters: string): Promise<void> {
  return new Promise((resolve) => preloadFont({ font: cardFontUrl(), characters }, () => resolve()));
}

