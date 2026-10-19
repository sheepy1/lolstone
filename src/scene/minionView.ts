// 场上随从（spec 5.4 v0.6.2）：台面上立着的带倒角方形底座，顶面嵌英雄头像。没有血条：攻击和生命是底座内部左下、右下
// 两个对称的凸起徽章（statBadge.ts），和手牌卡面上的位置一一对应。剧毒、吸血、风怒、法术伤害等小图标排在底座上沿、
// 头像上方。关键词的立体表现：圣盾是半透明发光外壳加生命徽章外圈的护盾环；嘲讽是底座外一圈金色自发光描边；
// 冻结是一层冰块材质；潜行是半透明加一团淡烟。能攻击是绿色发光描边，可选目标是红色。
import * as THREE from 'three';
import { getCard, type Keyword } from '../engine';
import { MINION_HEIGHT, MINION_SIZE } from '../presentation/layout';
import { EDGE_GLOW, flashMaterial, fresnelMaterial, glowMaterial, hdr, markBloom } from '../presentation/fx/materials';
import type { ViewMinion } from '../presentation/viewState';
import { makeLabelCanvas, portraitTexture } from './canvasArt';
import { MINION_BASE, MINION_RIM, MINION_TOP, UNIT_BOX, UNIT_SPHERE } from './geometry';
import { StatBadge, type BadgeKind } from './statBadge';
import { COLORS, FONT_CN } from './theme';
import { shared } from './dispose';

const ICONS: { k: Keyword; label: string; color: string }[] = [
  { k: 'taunt', label: '嘲', color: '#f0c040' },
  { k: 'poisonous', label: '毒', color: '#58c040' },
  { k: 'lifesteal', label: '吸', color: '#d0304a' },
  { k: 'windfury', label: '风', color: '#80d8e8' },
  { k: 'charge', label: '冲', color: '#e8a030' },
  { k: 'rush', label: '突', color: '#e8c860' },
];

// 徽章在底座顶面上的位置（底座中心为原点，+z 是近侧，也就是画面里的下方）
const BADGE_X = 0.44;
const BADGE_Z = 0.44;
const ICON_W = 512;
const ICON_H = 64;
const iconGeo = shared(new THREE.PlaneGeometry(1.24, 0.155));

const tauntMat = shared(glowMaterial(COLORS.taunt, 1.4));
// 描边亮度低于 bloom 阈值：描边本身亮，不往头像上泛光
export const attackRimMat = shared(glowMaterial(COLORS.playable, EDGE_GLOW));
const targetRimMat = shared(glowMaterial(COLORS.target, EDGE_GLOW * 1.3));
const iceMat = shared(new THREE.MeshStandardMaterial({
  color: 0x9fd8ff,
  transparent: true,
  opacity: 0.32,
  roughness: 0.08,
  metalness: 0.1,
  emissive: 0x1a4a6a,
  depthWrite: false,
}));
// 圣盾外壳：只有边缘亮（菲涅尔），正中几乎透明，头像和两个徽章透过外壳看得清。
// 不写深度、不进泛光：写深度会把壳里后画的徽章数字挡掉，整个壳泛光会把底座洗成一片白（发光的是生命徽章外圈的护盾环）
const shellMat = shared(fresnelMaterial(hdr(0xfff2b0, 1.6)));
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
  readonly badges: Record<BadgeKind, StatBadge> = { attack: new StatBadge('attack'), health: new StatBadge('health') };
  private readonly icons = makeLabelCanvas(ICON_W, ICON_H);
  private readonly iconPlane: THREE.Mesh;
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
    // 烟只罩头像中部，不挡两个徽章
    this.smoke.scale.set(1.5, 1.0, 1);
    this.smoke.position.set(0, 0.75, -0.15);
    markBloom(this.tauntRim);
    markBloom(this.stateRim);
    this.flash = new THREE.Mesh(UNIT_BOX, flashMaterial());
    this.flash.scale.set(MINION_SIZE + 0.04, MINION_HEIGHT + 0.04, MINION_SIZE + 0.04);
    this.flash.position.y = MINION_HEIGHT / 2;
    this.badges.attack.position.set(-BADGE_X, MINION_HEIGHT, BADGE_Z);
    this.badges.health.position.set(BADGE_X, MINION_HEIGHT, BADGE_Z);
    this.iconPlane = new THREE.Mesh(iconGeo, new THREE.MeshBasicMaterial({ map: this.icons.texture, transparent: true, toneMapped: false }));
    this.iconPlane.rotation.x = -Math.PI / 2;
    this.iconPlane.position.set(0, MINION_HEIGHT + 0.012, -0.55);
    this.body.add(base, top, this.tauntRim, this.stateRim, this.ice, this.shell, this.smoke, this.flash, this.badges.attack, this.badges.health, this.iconPlane);
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
    // 数字颜色和卡面一致：受伤的生命红，增益后高于卡面的绿，减益低于卡面的红
    const baseAtk = def.attack ?? 0;
    const baseHp = def.health ?? 0;
    this.badges.attack.set(m.attack, m.attack > baseAtk ? COLORS.buffed : m.attack < baseAtk ? COLORS.debuffed : 0xffffff);
    this.badges.health.set(
      m.health,
      m.health < m.maxHealth ? COLORS.debuffed : m.maxHealth > baseHp ? COLORS.buffed : m.maxHealth < baseHp ? COLORS.debuffed : 0xffffff,
    );
    this.badges.health.setShield(shield);
    const key = JSON.stringify([m.keywords, m.silenced, spellDamage]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    // 底座上沿的 buff 小图标
    const icons = ICONS.filter((i) => m.keywords.includes(i.k)).map((i) => ({ label: i.label, color: i.color }));
    if (spellDamage > 0) icons.push({ label: `法${spellDamage}`, color: '#9a6cff' });
    if (m.silenced) icons.push({ label: '默', color: '#808080' });
    const a = this.icons.g;
    a.clearRect(0, 0, ICON_W, ICON_H);
    const shown = icons.slice(0, 6);
    shown.forEach((ic, i) => {
      const x = ICON_W / 2 + (i - (shown.length - 1) / 2) * 62 - 27;
      a.fillStyle = 'rgba(0,0,0,0.55)';
      a.beginPath();
      a.roundRect(x - 3, 4, 60, 56, 10);
      a.fill();
      a.fillStyle = ic.color;
      a.strokeStyle = '#101010';
      a.lineWidth = 3;
      a.beginPath();
      a.roundRect(x, 7, 54, 50, 9);
      a.fill();
      a.stroke();
      a.font = `900 ${ic.label.length > 1 ? 22 : 32}px ${FONT_CN}`;
      a.textAlign = 'center';
      a.textBaseline = 'middle';
      a.fillStyle = '#101010';
      a.fillText(ic.label, x + 27, 33);
    });
    this.iconPlane.visible = shown.length > 0;
    this.icons.texture.needsUpdate = true;
  }

  // 动画中途先跳数字（显示局面之外的临时数值）
  showHealth(health: number): void {
    if (!this.last) return;
    this.drawHud({ ...this.last, health });
  }

  showAttack(attack: number): void {
    if (!this.last) return;
    this.drawHud({ ...this.last, attack });
  }

  // 圣盾被打破：生命徽章的护盾环碎掉（外壳由动画模块碎成粒子）
  breakShield(): void {
    this.badges.health.breakShield();
    this.shell.visible = false;
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
