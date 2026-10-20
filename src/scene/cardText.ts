// 卡面文字（spec 5.4、6.1）：费用、名字、文本、攻击、生命用 troika-three-text 的 SDF 文本，叠在卡面底图上，
// 透视缩小、放大都清晰。字体是按卡池用到的字做的子集（public/fonts，生成方法见 NOTES「M3 表现层」）。
// 坐标是卡牌本地坐标（卡牌中心为原点，宽 CARD_W、高 CARD_H），和 canvasArt.ts 里卡面底图的版式一一对应。
// 正文的断行和字号由 cardTextLayout.ts 算（troika 只在空白处折行，中文整句不会折）。
import { preloadFont, Text } from 'troika-three-text';
import { getCard, type CardDef } from '../engine';
import { cardFontUrl } from '../assets/manifest';
import { CARD_H, CARD_T, CARD_W } from '../presentation/layout';
import { approxMeasure, layoutBody, type BodyBox, type BodyLayout, type Measure } from './cardTextLayout';
import { COLORS } from './theme';

// 卡面底图是 512×716 的 canvas，这里把它的像素坐标换成卡牌本地坐标
const PX = CARD_W / 512;
const at = (px: number, py: number): [number, number] => [-CARD_W / 2 + px * PX, CARD_H / 2 - py * PX];

const Z = CARD_T / 2 + 0.004;

type Slot = 'cost' | 'name' | 'body' | 'attack' | 'health';

// 正文文本框（canvasArt.ts 的文本框是 x 48 到 464、y 475 到 656 像素）。正文从 y 488 起排，左右各留 6 像素；
// 随从卡底部两角有攻击、生命圆章（顶边在 y 594），正文排到 y 592 为止，法术卡排到 y 648。
const BODY_TOP = 488;
const BODY_FONT = 0.088;
const BODY_LINE = 1.3;
const BODY_WIDTH = (464 - 48 - 12) * PX;
export const BODY_BOX: Record<'minion' | 'spell', BodyBox> = {
  minion: { width: BODY_WIDTH, height: (592 - BODY_TOP) * PX, fontSize: BODY_FONT, lineHeight: BODY_LINE },
  spell: { width: BODY_WIDTH, height: (648 - BODY_TOP) * PX, fontSize: BODY_FONT, lineHeight: BODY_LINE },
};

// 量宽度用的 canvas 和卡面字体。字体加载好之前用近似宽度，加载好后之前建的卡重新排一次。
const MEASURE_FAMILY = 'LoLstone Card Measure';
let measureCtx: CanvasRenderingContext2D | null = null;
let measureFontReady = false;
let measureFontLoading: Promise<void> | null = null;
const live = new Set<CardTexts>();
const layoutCache = new Map<string, BodyLayout>();

const measure: Measure = (s) => {
  if (!measureFontReady) return approxMeasure(s);
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
    measureCtx.font = `700 100px "${MEASURE_FAMILY}"`;
  }
  return measureCtx.measureText(s).width / 100;
};

function loadMeasureFont(): Promise<void> {
  if (measureFontLoading) return measureFontLoading;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  const face = new FontFace(MEASURE_FAMILY, `url(${cardFontUrl()})`, { weight: '700' });
  measureFontLoading = face
    .load()
    .then((f) => {
      document.fonts.add(f);
      measureFontReady = true;
      layoutCache.clear();
      for (const t of live) t.relayout();
      live.clear();
    })
    .catch(() => {
      // 字体文件缺失：一直用近似宽度，troika 那边也会退回默认字体
    });
  return measureFontLoading;
}

function bodyLayout(def: CardDef): BodyLayout {
  const kind = def.type === 'minion' ? 'minion' : 'spell';
  const key = `${kind}|${def.text}`;
  let l = layoutCache.get(key);
  if (!l) {
    l = layoutBody(def.text, measure, BODY_BOX[kind]);
    layoutCache.set(key, l);
  }
  return l;
}

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
    [body.position.x, body.position.y] = at(256, BODY_TOP);
    body.anchorY = 'top';
    body.fontSize = BODY_FONT;
    // 换行由 bodyLayout 算好写进文本；maxWidth 比排版宽度宽一点，量出来的宽度和 troika 有细微出入时不会再被它折一次
    body.maxWidth = BODY_WIDTH + 0.06;
    body.overflowWrap = 'break-word';
    body.textAlign = 'center';
    body.lineHeight = BODY_LINE;
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
    // 只记字体加载好之前建的卡（一般是加载页之前就建好的，很少），加载好后重排一次就不再引用，不拖住已销毁的卡
    if (!measureFontReady) live.add(this);
    void loadMeasureFont();
  }

  // 卡面字体加载好后按准确宽度重新断行
  relayout(): void {
    if (!this.def) return;
    const l = bodyLayout(this.def);
    this.texts.body.text = l.lines.join('\n');
    this.texts.body.fontSize = l.fontSize;
    this.texts.body.sync();
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
    const body = bodyLayout(def);
    t.body.text = body.lines.join('\n');
    t.body.fontSize = body.fontSize;
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
    live.delete(this);
    for (const x of Object.values(this.texts)) x.dispose();
  }
}

// 加载页预载字体和本局用到的字，开局时卡面文字不用临时排版
// 同时加载正文断行量宽度用的同一份字体
export function preloadCardFont(characters: string): Promise<void> {
  return Promise.all([
    new Promise<void>((resolve) => preloadFont({ font: cardFontUrl(), characters }, () => resolve())),
    loadMeasureFont(),
  ]).then(() => {});
}

