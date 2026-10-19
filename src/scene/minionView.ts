// 场上随从（spec 5.4 "峡谷战局"）：方形头像，上方是 LoL 式血条（生命上限不超过 10 时按每点一段画，
// 超过 10 改连续血条），旁边是生命数字；下方剑形图标加攻击数字。关键词状态先用简单图形区分：
// 嘲讽金色描边加盾形小图标，潜行半透明加"视野被遮"图标，冻结盖一层冰，圣盾是血条末端的白色护盾段，
// 剧毒、吸血、风怒、法术伤害等是头像下方一排小图标。
import { Container, Graphics, Text } from 'pixi.js';
import { getCard, type Keyword } from '../engine';
import { MINION_SIZE } from '../presentation/layout';
import { glowFilter } from '../presentation/fx/filters';
import type { ViewMinion } from '../presentation/viewState';
import { Portrait } from './portrait';
import { COLORS, FONT_CN, FONT_NUM } from './theme';

const S = MINION_SIZE;
const BAR_W = S + 8;
const BAR_H = 12;
const BAR_Y = -S / 2 - 18;

const ICON_KEYWORDS: { k: Keyword; label: string; color: number }[] = [
  { k: 'poisonous', label: '毒', color: 0x58c040 },
  { k: 'lifesteal', label: '吸', color: 0xd0304a },
  { k: 'windfury', label: '风', color: 0x80d8e8 },
  { k: 'charge', label: '冲', color: 0xe8a030 },
  { k: 'rush', label: '突', color: 0xe8c860 },
];

function num(size: number): Text {
  const t = new Text({
    text: '',
    style: { fontFamily: FONT_NUM, fontSize: size, fill: 0xffffff, fontWeight: '900', stroke: { color: 0x000000, width: 5 } },
  });
  t.anchor.set(0.5);
  t.resolution = 2;
  return t;
}

export class MinionView extends Container {
  readonly instanceId: number;
  cardId: string;
  side: 0 | 1;
  // 动画模块在这个容器上做位移、缩放、抖动，不影响布局用的外层坐标
  readonly body = new Container();
  private portrait = new Portrait(S);
  private frame = new Graphics();
  private glow = new Graphics();
  private ice = new Graphics();
  private stealthIcon = new Container();
  private tauntIcon = new Container();
  private bar = new Graphics();
  private hpText = num(26);
  private atkIcon = new Graphics();
  private atkText = num(26);
  private icons = new Container();
  readonly flash = new Graphics();
  private last: ViewMinion | null = null;

  constructor(m: ViewMinion, side: 0 | 1) {
    super();
    this.instanceId = m.instanceId;
    this.cardId = m.cardId;
    this.side = side;
    this.glow.rect(-S / 2 - 7, -S / 2 - 7, S + 14, S + 14).stroke({ width: 5, color: COLORS.playable });
    this.glow.filters = [glowFilter(COLORS.playable)];
    this.glow.visible = false;
    this.ice.rect(-S / 2, -S / 2, S, S).fill({ color: COLORS.frost, alpha: 0.5 });
    this.ice.moveTo(-S / 2 + 8, S / 2 - 10).lineTo(-6, -8).lineTo(10, 12).lineTo(S / 2 - 8, -S / 2 + 10).stroke({ width: 3, color: 0xffffff, alpha: 0.8 });
    this.flash.rect(-S / 2, -S / 2, S, S).fill(0xffffff);
    this.flash.alpha = 0;
    this.buildIcons();
    // 剑形图标
    this.atkIcon
      .poly([-4, -14, 4, -14, 4, 6, 10, 6, 10, 10, 2, 10, 2, 16, -2, 16, -2, 10, -10, 10, -10, 6, -4, 6])
      .fill(0xe8d6a0)
      .stroke({ width: 2, color: 0x2a2010 });
    this.atkIcon.position.set(-24, S / 2 + 20);
    this.atkText.position.set(4, S / 2 + 20);
    this.hpText.position.set(BAR_W / 2 + 18, BAR_Y + BAR_H / 2);
    this.icons.position.set(0, S / 2 + 46);
    this.body.addChild(this.glow, this.portrait, this.ice, this.flash, this.frame, this.tauntIcon, this.stealthIcon, this.bar, this.hpText, this.atkIcon, this.atkText, this.icons);
    this.addChild(this.body);
    this.update(m);
  }

  private buildIcons(): void {
    // 嘲讽：盾形小图标
    const shield = new Graphics().poly([0, -12, 11, -7, 9, 7, 0, 13, -9, 7, -11, -7]).fill(COLORS.taunt).stroke({ width: 2, color: 0x3a2a08 });
    this.tauntIcon.addChild(shield);
    this.tauntIcon.position.set(-S / 2 - 2, -S / 2 + 4);
    // 潜行：被划掉的眼睛
    const eye = new Graphics()
      .ellipse(0, 0, 13, 8)
      .fill(0x202030)
      .stroke({ width: 2, color: 0xd0d0ff })
      .circle(0, 0, 3.5)
      .fill(0xd0d0ff)
      .moveTo(-12, 9)
      .lineTo(12, -9)
      .stroke({ width: 3, color: 0xff8080 });
    this.stealthIcon.addChild(eye);
    this.stealthIcon.position.set(S / 2 - 2, -S / 2 + 4);
  }

  // 按显示局面刷新数值和状态。
  update(m: ViewMinion): void {
    if (m.cardId !== this.cardId) this.cardId = m.cardId;
    this.portrait.show(m.cardId);
    const def = getCard(m.cardId);
    const has = (k: Keyword) => m.keywords.includes(k);

    this.frame.clear();
    if (has('taunt')) this.frame.rect(-S / 2 - 3, -S / 2 - 3, S + 6, S + 6).stroke({ width: 6, color: COLORS.taunt });
    else this.frame.rect(-S / 2, -S / 2, S, S).stroke({ width: 3, color: 0x101010 });
    this.tauntIcon.visible = has('taunt');
    this.stealthIcon.visible = has('stealth');
    this.portrait.alpha = has('stealth') ? 0.5 : 1;
    this.ice.visible = m.frozen;

    this.drawBar(m, has('divine_shield'));

    const baseAtk = def.attack ?? 0;
    const baseHp = def.health ?? 0;
    this.atkText.text = String(m.attack);
    this.atkText.style.fill = m.attack > baseAtk ? COLORS.buffed : m.attack < baseAtk ? COLORS.debuffed : 0xffffff;
    this.hpText.text = String(m.health);
    this.hpText.style.fill = m.health < m.maxHealth ? COLORS.debuffed : m.maxHealth > baseHp ? COLORS.buffed : 0xffffff;

    this.icons.removeChildren().forEach((c) => c.destroy({ children: true }));
    const marks = ICON_KEYWORDS.filter((i) => has(i.k));
    const spellDamage = m.silenced ? 0 : (def.effects ?? []).reduce((n, e) => (e.trigger === 'static' && e.kind === 'spell_damage' ? n + e.amount : n), 0);
    const all = [...marks.map((i) => ({ label: i.label, color: i.color }))];
    if (spellDamage > 0) all.push({ label: `法${spellDamage}`, color: 0x9a6cff });
    if (m.silenced) all.push({ label: '默', color: 0x707070 });
    all.forEach((i, idx) => {
      const c = new Container();
      c.addChild(new Graphics().roundRect(-15, -12, 30, 24, 5).fill(i.color).stroke({ width: 2, color: 0x101010 }));
      const t = new Text({ text: i.label, style: { fontFamily: FONT_CN, fontSize: 14, fill: 0x101010, fontWeight: '700' } });
      t.anchor.set(0.5);
      t.resolution = 2;
      c.addChild(t);
      c.x = (idx - (all.length - 1) / 2) * 34;
      this.icons.addChild(c);
    });
    this.last = m;
  }

  private drawBar(m: ViewMinion, shield: boolean): void {
    const g = this.bar.clear();
    const x0 = -BAR_W / 2;
    const shieldW = shield ? 16 : 0;
    const w = BAR_W - shieldW;
    g.rect(x0 - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4).fill(COLORS.hpBack);
    const color = this.side === 0 ? COLORS.hpSegment : COLORS.hpSegmentEnemy;
    if (m.maxHealth <= 10) {
      const seg = w / Math.max(1, m.maxHealth);
      for (let i = 0; i < m.maxHealth; i++) {
        const filled = i < m.health;
        g.rect(x0 + i * seg + 1, BAR_Y, seg - 2, BAR_H).fill(filled ? color : 0x3a3a3a);
      }
    } else {
      g.rect(x0, BAR_Y, w, BAR_H).fill(0x3a3a3a);
      g.rect(x0, BAR_Y, (w * Math.max(0, m.health)) / m.maxHealth, BAR_H).fill(color);
    }
    if (shield) g.rect(x0 + w + 1, BAR_Y - 1, shieldW - 1, BAR_H + 2).fill(COLORS.shield);
  }

  // 显示局面之外的临时数值（动画中途先跳数字）。
  showHealth(health: number): void {
    if (!this.last) return;
    this.update({ ...this.last, health });
  }

  // 高亮：attack 能攻击（绿色光边），target 是当前可选的目标（红色准星光边），dim 是当前不可选（变暗）。
  setHighlight(mode: 'none' | 'attack' | 'target' | 'dim'): void {
    this.body.tint = mode === 'dim' ? 0x707070 : 0xffffff;
    this.glow.visible = mode === 'attack' || mode === 'target';
    if (!this.glow.visible) return;
    const color = mode === 'target' ? COLORS.target : COLORS.playable;
    this.glow.clear().rect(-S / 2 - 7, -S / 2 - 7, S + 14, S + 14).stroke({ width: 5, color });
    this.glow.filters = [glowFilter(color)];
  }

  // 召唤失调、我方回合不能动的随从略暗。
  setSleepy(on: boolean): void {
    this.portrait.tint = on ? 0xb0b0b0 : 0xffffff;
  }
}
