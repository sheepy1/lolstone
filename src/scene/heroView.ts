// 英雄：水晶枢纽上嵌着英雄头像，生命值数字显示在枢纽上（spec 5.2）。生命低于 10 时枢纽闪烁。
// 枢纽、技能图标都是占位图形，M4 换成素材。
import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { getCard, getHeroClass, type HeroClass } from '../engine';
import { glowFilter } from '../presentation/fx/filters';
import { Portrait } from './portrait';
import { COLORS, FONT_CN, FONT_NUM, REGION_COLORS } from './theme';

function num(size: number, fill = 0xffffff): Text {
  const t = new Text({
    text: '',
    style: { fontFamily: FONT_NUM, fontSize: size, fill, fontWeight: '900', stroke: { color: 0x000000, width: 6 } },
  });
  t.anchor.set(0.5);
  t.resolution = 2;
  return t;
}

export class HeroView extends Container {
  readonly body = new Container();
  readonly flash = new Graphics();
  private crystal = new Graphics();
  private portrait = new Portrait(96);
  private hp = num(34);
  private glow = new Graphics();
  private low: gsap.core.Tween | null = null;
  readonly radius = 86;

  constructor(cls: HeroClass, enemy: boolean) {
    super();
    const colors = REGION_COLORS[cls];
    const r = this.radius;
    this.crystal
      .poly([0, -r, r * 0.95, -r * 0.3, r * 0.6, r * 0.8, -r * 0.6, r * 0.8, -r * 0.95, -r * 0.3])
      .fill({ color: enemy ? 0x5a1a22 : 0x1a3a5a })
      .stroke({ width: 6, color: colors.frame });
    this.crystal.poly([0, -r + 14, r * 0.8, -r * 0.26, 0, r * 0.2, -r * 0.8, -r * 0.26]).fill({ color: 0xffffff, alpha: 0.08 });
    const champion = getHeroClass(cls).champion;
    this.portrait.show(`hero:${cls}`, champion);
    this.portrait.y = -6;
    const mask = new Graphics().circle(0, -6, 46).fill(0xffffff);
    this.portrait.mask = mask;
    const ring = new Graphics().circle(0, -6, 48).stroke({ width: 4, color: colors.accent });
    const hpBack = new Graphics().circle(0, 0, 26).fill(0xb02020).stroke({ width: 3, color: 0x300000 });
    hpBack.position.set(r * 0.62, r * 0.55);
    this.hp.position.copyFrom(hpBack.position);
    this.glow.circle(0, -6, 60).stroke({ width: 6, color: COLORS.target });
    this.glow.filters = [glowFilter(COLORS.target)];
    this.glow.visible = false;
    this.flash.circle(0, -6, 48).fill(0xffffff);
    this.flash.alpha = 0;
    this.body.addChild(this.crystal, this.glow, this.portrait, mask, ring, this.flash, hpBack, this.hp);
    this.addChild(this.body);
  }

  setHealth(health: number, max: number): void {
    this.hp.text = String(health);
    this.hp.style.fill = health < max ? COLORS.debuffed : 0xffffff;
    const lowNow = health < 10;
    if (lowNow && !this.low) {
      this.low = gsap.to(this.crystal, { alpha: 0.55, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    } else if (!lowNow && this.low) {
      this.low.kill();
      this.low = null;
      this.crystal.alpha = 1;
    }
  }

  setTargetable(mode: 'none' | 'target' | 'dim'): void {
    this.glow.visible = mode === 'target';
    this.body.alpha = mode === 'dim' ? 0.7 : 1;
  }
}

// 英雄技能：方形技能图标，用过之后盖上灰色冷却遮罩。
export class HeroPowerView extends Container {
  readonly body = new Container();
  private cover = new Graphics();
  private glow = new Graphics();
  readonly size = 76;

  constructor(cls: HeroClass) {
    super();
    const def = getCard(getHeroClass(cls).heroPower);
    const colors = REGION_COLORS[cls];
    const s = this.size;
    const bg = new Graphics().rect(-s / 2, -s / 2, s, s).fill(colors.inner).stroke({ width: 4, color: colors.frame });
    bg.poly([0, -s / 2 + 10, s / 2 - 10, 0, 0, s / 2 - 10, -s / 2 + 10, 0]).fill({ color: colors.accent, alpha: 0.6 });
    const name = new Text({
      text: def.name,
      style: { fontFamily: FONT_CN, fontSize: 20, fill: 0xffffff, fontWeight: '700', stroke: { color: 0x000000, width: 4 } },
    });
    name.anchor.set(0.5);
    name.resolution = 2;
    const cost = new Graphics().circle(0, 0, 14).fill(COLORS.mana).stroke({ width: 2, color: COLORS.hexGold });
    cost.position.set(0, -s / 2 - 4);
    const costText = num(16);
    costText.text = String(def.cost);
    costText.position.copyFrom(cost.position);
    this.cover.rect(-s / 2, -s / 2, s, s).fill({ color: 0x202020, alpha: 0.72 });
    this.cover.visible = false;
    this.glow.rect(-s / 2 - 6, -s / 2 - 6, s + 12, s + 12).stroke({ width: 5, color: COLORS.playable });
    this.glow.filters = [glowFilter(COLORS.playable)];
    this.glow.visible = false;
    this.body.addChild(this.glow, bg, name, this.cover, cost, costText);
    this.addChild(this.body);
  }

  setUsed(used: boolean): void {
    this.cover.visible = used;
  }

  setUsable(on: boolean): void {
    this.glow.visible = on;
  }
}
