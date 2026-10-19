// 场上随从（spec 5.4 "峡谷战局"）：台面上立着的带倒角方形底座，顶面贴英雄头像。
// 血条和生命数字、攻击数字和 buff 小图标是两块 canvas 贴图的 sprite，始终朝镜头、清晰可读：
// 血条在底座远侧上方（画面里在头像上方），攻击在近侧（画面里在头像下方）。
// 关键词的立体表现：圣盾是半透明发光外壳加血条末端的白色护盾段；嘲讽是底座外一圈金色自发光描边；
// 冻结是一层冰块材质；潜行是半透明加一团淡烟。能攻击是绿色发光描边，可选目标是红色。
import * as THREE from 'three';
import { getCard, type Keyword } from '../engine';
import { MINION_HEIGHT, MINION_SIZE } from '../presentation/layout';
import { EDGE_GLOW, flashMaterial, glowMaterial, hdr } from '../presentation/fx/materials';
import type { ViewMinion } from '../presentation/viewState';
import { makeLabelCanvas, portraitTexture, strokeText, type Label } from './canvasArt';
import { MINION_BASE, MINION_RIM, MINION_TOP, UNIT_BOX, UNIT_SPHERE } from './geometry';
import { COLORS, css, FONT_CN, FONT_NUM } from './theme';
import { shared } from './dispose';

const ICONS: { k: Keyword; label: string; color: string }[] = [
  { k: 'poisonous', label: '毒', color: '#58c040' },
  { k: 'lifesteal', label: '吸', color: '#d0304a' },
  { k: 'windfury', label: '风', color: '#80d8e8' },
  { k: 'charge', label: '冲', color: '#e8a030' },
  { k: 'rush', label: '突', color: '#e8c860' },
];

const tauntMat = shared(glowMaterial(COLORS.taunt, 2.7));
// 描边亮度低于 bloom 阈值：描边本身亮，不往头像上泛光
const attackRimMat = shared(glowMaterial(COLORS.playable, EDGE_GLOW));
const targetRimMat = shared(glowMaterial(COLORS.target, EDGE_GLOW * 1.6));
const iceMat = shared(new THREE.MeshStandardMaterial({
  color: 0xbfe9ff,
  transparent: true,
  opacity: 0.5,
  roughness: 0.08,
  metalness: 0.1,
  emissive: 0x1a4a6a,
  depthWrite: false,
}));
const shellMat = shared(new THREE.MeshBasicMaterial({
  color: hdr(0xfff2b0, 1.4),
  transparent: true,
  opacity: 0.22,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
}));
const smokeTex = shared((() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(160,160,180,0.85)');
  grad.addColorStop(1, 'rgba(160,160,180,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})());

const HP_W = 384;
const HP_H = 72;
const ATK_W = 384;
const ATK_H = 84;

function hudSprite(label: Label, width: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.texture, transparent: true, toneMapped: false }));
  s.scale.set(width, (width * label.canvas.height) / label.canvas.width, 1);
  s.renderOrder = 4;
  return s;
}

export class MinionView extends THREE.Group {
  readonly instanceId: number;
  cardId: string;
  side: 0 | 1;
  // 动画在 body 上做位移、缩放、抖动，外层 Group 的位置归布局管
  readonly body = new THREE.Group();
  readonly flash: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly baseMat: THREE.MeshStandardMaterial;
  private readonly topMat: THREE.MeshStandardMaterial;
  private readonly tauntRim: THREE.Mesh;
  private readonly stateRim: THREE.Mesh;
  private readonly ice: THREE.Mesh;
  private readonly shell: THREE.Mesh;
  private readonly smoke: THREE.Sprite;
  private readonly hp = makeLabelCanvas(HP_W, HP_H);
  private readonly atk = makeLabelCanvas(ATK_W, ATK_H);
  private last: ViewMinion | null = null;
  private hudKey = '';
  private stealthed = false;
  private tone = { sleepy: false, dim: false, dead: false };

  constructor(m: ViewMinion, side: 0 | 1) {
    super();
    this.instanceId = m.instanceId;
    this.cardId = m.cardId;
    this.side = side;
    this.baseMat = new THREE.MeshStandardMaterial({ color: side === 0 ? 0x3a4a5c : 0x5a3a3a, roughness: 0.7, metalness: 0.25 });
    this.topMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
    const base = new THREE.Mesh(MINION_BASE, this.baseMat);
    base.castShadow = true;
    base.receiveShadow = true;
    const top = new THREE.Mesh(MINION_TOP, this.topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = MINION_HEIGHT + 0.004;
    this.tauntRim = new THREE.Mesh(MINION_RIM, tauntMat);
    this.tauntRim.position.y = 0.01;
    this.stateRim = new THREE.Mesh(MINION_RIM, attackRimMat);
    this.stateRim.scale.set(1.12, 1.4, 1.12);
    this.stateRim.visible = false;
    this.ice = new THREE.Mesh(UNIT_BOX, iceMat);
    this.ice.scale.set(MINION_SIZE + 0.1, MINION_HEIGHT + 0.22, MINION_SIZE + 0.1);
    this.ice.position.y = (MINION_HEIGHT + 0.22) / 2;
    this.shell = new THREE.Mesh(UNIT_SPHERE, shellMat);
    this.shell.scale.set(1.15, 0.7, 1.15);
    this.shell.position.y = 0.15;
    this.smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.55, depthWrite: false }));
    this.smoke.scale.set(2.2, 1.4, 1);
    this.smoke.position.y = 0.6;
    this.flash = new THREE.Mesh(UNIT_BOX, flashMaterial());
    this.flash.scale.set(MINION_SIZE + 0.04, MINION_HEIGHT + 0.04, MINION_SIZE + 0.04);
    this.flash.position.y = MINION_HEIGHT / 2;
    const hpSprite = hudSprite(this.hp, 2.0);
    hpSprite.position.set(0.12, 0.8, -1.0);
    const atkSprite = hudSprite(this.atk, 2.0);
    atkSprite.position.set(0, 0.45, 1.02);
    this.body.add(base, top, this.tauntRim, this.stateRim, this.ice, this.shell, this.smoke, this.flash, hpSprite, atkSprite);
    this.add(this.body);
    this.userData.pick = { kind: 'minion', id: m.instanceId, side };
    this.update(m);
  }

  // 按显示局面刷新数值和状态。
  update(m: ViewMinion): void {
    this.cardId = m.cardId;
    const tex = portraitTexture(m.cardId);
    if (this.topMat.map !== tex) {
      this.topMat.map = tex;
      this.topMat.needsUpdate = true;
    }
    const has = (k: Keyword) => m.keywords.includes(k);
    this.tauntRim.visible = has('taunt');
    this.ice.visible = m.frozen;
    this.shell.visible = has('divine_shield');
    const stealth = has('stealth');
    if (stealth !== this.stealthed) {
      this.stealthed = stealth;
      for (const mat of [this.baseMat, this.topMat]) {
        mat.transparent = stealth;
        mat.opacity = stealth ? 0.45 : 1;
        mat.needsUpdate = true;
      }
    }
    this.smoke.visible = stealth;
    this.last = m;
    this.drawHud(m);
  }

  private drawHud(m: ViewMinion): void {
    const def = getCard(m.cardId);
    const shield = m.keywords.includes('divine_shield');
    const spellDamage = m.silenced
      ? 0
      : (def.effects ?? []).reduce((n, e) => (e.trigger === 'static' && e.kind === 'spell_damage' ? n + e.amount : n), 0);
    const key = JSON.stringify([m.attack, m.health, m.maxHealth, shield, m.keywords, m.silenced, spellDamage]);
    if (key === this.hudKey) return;
    this.hudKey = key;

    // 血条：上限不超过 10 按每点一段，超过 10 连续；末端白色护盾段；右边生命数字
    const g = this.hp.g;
    g.clearRect(0, 0, HP_W, HP_H);
    const x0 = 10;
    const barW = 270;
    const y = 18;
    const h = 36;
    g.fillStyle = 'rgba(8,10,14,0.92)';
    g.fillRect(x0 - 6, y - 6, barW + 12, h + 12);
    const shieldW = shield ? 30 : 0;
    const w = barW - shieldW;
    const color = this.side === 0 ? css(COLORS.hpSegment) : css(COLORS.hpSegmentEnemy);
    if (m.maxHealth <= 10) {
      const seg = w / Math.max(1, m.maxHealth);
      for (let i = 0; i < m.maxHealth; i++) {
        g.fillStyle = i < m.health ? color : '#3a3a3a';
        g.fillRect(x0 + i * seg + 2, y, seg - 4, h);
      }
    } else {
      g.fillStyle = '#3a3a3a';
      g.fillRect(x0, y, w, h);
      g.fillStyle = color;
      g.fillRect(x0, y, (w * Math.max(0, m.health)) / m.maxHealth, h);
    }
    if (shield) {
      g.fillStyle = '#ffffff';
      g.fillRect(x0 + w + 3, y - 3, shieldW - 3, h + 6);
    }
    const baseHp = def.health ?? 0;
    const hpColor = m.health < m.maxHealth ? css(COLORS.debuffed) : m.maxHealth > baseHp ? css(COLORS.buffed) : '#ffffff';
    strokeText(g, String(Math.max(0, m.health)), 336, HP_H / 2 + 2, 62, hpColor, FONT_NUM, 0.16);
    this.hp.texture.needsUpdate = true;

    // 攻击：剑形图标加数字；右边一排 buff 小图标
    const a = this.atk.g;
    a.clearRect(0, 0, ATK_W, ATK_H);
    a.save();
    a.translate(62, ATK_H / 2);
    a.fillStyle = '#e8d6a0';
    a.strokeStyle = '#2a2010';
    a.lineWidth = 4;
    a.beginPath();
    a.moveTo(-6, -32);
    a.lineTo(6, -32);
    a.lineTo(6, 10);
    a.lineTo(18, 10);
    a.lineTo(18, 18);
    a.lineTo(4, 18);
    a.lineTo(4, 32);
    a.lineTo(-4, 32);
    a.lineTo(-4, 18);
    a.lineTo(-18, 18);
    a.lineTo(-18, 10);
    a.lineTo(-6, 10);
    a.closePath();
    a.fill();
    a.stroke();
    a.restore();
    const baseAtk = def.attack ?? 0;
    const atkColor = m.attack > baseAtk ? css(COLORS.buffed) : m.attack < baseAtk ? css(COLORS.debuffed) : '#ffffff';
    strokeText(a, String(m.attack), 128, ATK_H / 2 + 2, 66, atkColor, FONT_NUM, 0.16);
    const icons = ICONS.filter((i) => m.keywords.includes(i.k)).map((i) => ({ label: i.label, color: i.color }));
    if (m.keywords.includes('taunt')) icons.unshift({ label: '嘲', color: css(COLORS.taunt) });
    if (spellDamage > 0) icons.push({ label: `法${spellDamage}`, color: '#9a6cff' });
    if (m.silenced) icons.push({ label: '默', color: '#808080' });
    icons.slice(0, 4).forEach((ic, i) => {
      const x = 196 + i * 46;
      a.fillStyle = ic.color;
      a.strokeStyle = '#101010';
      a.lineWidth = 3;
      a.beginPath();
      a.roundRect(x, 18, 42, 48, 8);
      a.fill();
      a.stroke();
      a.font = `900 ${ic.label.length > 1 ? 20 : 28}px ${FONT_CN}`;
      a.textAlign = 'center';
      a.textBaseline = 'middle';
      a.fillStyle = '#101010';
      a.fillText(ic.label, x + 21, 43);
    });
    this.atk.texture.needsUpdate = true;
  }

  // 动画中途先跳数字（显示局面之外的临时数值）。
  showHealth(health: number): void {
    if (!this.last) return;
    this.drawHud({ ...this.last, health });
  }

  // 高亮：attack 能攻击（绿边），target 是当前可选的目标（红边），dim 是当前不可选（变暗）。
  setHighlight(mode: 'none' | 'attack' | 'target' | 'dim'): void {
    this.stateRim.visible = mode === 'attack' || mode === 'target';
    this.stateRim.material = mode === 'target' ? targetRimMat : attackRimMat;
    this.tone.dim = mode === 'dim';
    this.applyTone();
  }

  // 召唤失调、我方回合不能动的随从略暗。
  setSleepy(on: boolean): void {
    this.tone.sleepy = on;
    this.applyTone();
  }

  // 死亡：变灰
  setDead(): void {
    this.tone.dead = true;
    this.applyTone();
  }

  private applyTone(): void {
    const k = this.tone.dead ? 0.35 : this.tone.dim ? 0.4 : this.tone.sleepy ? 0.7 : 1;
    this.topMat.color.setScalar(k);
    if (this.tone.dead) this.topMat.color.setRGB(0.35, 0.35, 0.38);
  }
}
