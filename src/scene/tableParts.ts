// 台面上的实体物件：法力水晶条、牌库、结束回合按钮、对方思考提示（棋盘在 board.ts）。占位几何体，M4 换素材。
import gsap from 'gsap';
import * as THREE from 'three';
import type { ManaSnapshot } from '../engine';
import { MANA_STEP } from '../presentation/layout';
import { flashMaterial, markBloom } from '../presentation/fx/materials';
import { textSprite } from '../presentation/fx/effects';
import { cardBackTexture, makeLabelCanvas, strokeText } from './canvasArt';
import { COLORS, FONT_CN } from './theme';
import { shared } from './dispose';

const gemGeo = shared(new THREE.OctahedronGeometry(0.2, 0));
const socketGeo = shared(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 8));
const gemMats = {
  full: shared(new THREE.MeshStandardMaterial({ color: 0x3a8cff, emissive: COLORS.mana, emissiveIntensity: 1.6, roughness: 0.2, flatShading: true })),
  temp: shared(new THREE.MeshStandardMaterial({ color: 0x45e0d0, emissive: COLORS.manaTemp, emissiveIntensity: 1.6, roughness: 0.2, flatShading: true })),
  spent: shared(new THREE.MeshStandardMaterial({ color: 0x1a2a40, emissive: 0x0a1428, emissiveIntensity: 0.3, roughness: 0.4, flatShading: true })),
  locked: shared(new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.7, transparent: true, opacity: 0.35, flatShading: true })),
};
const socketMat = shared(new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.6, metalness: 0.5 }));

// 法力条：10 颗水晶立在台面上。可用的亮（自发光进 bloom），用掉的暗，临时法力另一种颜色，未解锁的熄灭变小。
export class ManaBarView extends THREE.Group {
  readonly flash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly gems: THREE.Mesh[] = [];
  private readonly label = makeLabelCanvas(192, 96);
  private last = '';

  constructor() {
    super();
    for (let i = 0; i < 10; i++) {
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.position.set(i * MANA_STEP, 0.04, 0);
      socket.receiveShadow = true;
      const gem = new THREE.Mesh(gemGeo, gemMats.locked);
      gem.position.set(i * MANA_STEP, 0.32, 0);
      gem.scale.set(1, 1.4, 1);
      gem.castShadow = true;
      this.gems.push(gem);
      this.add(socket, gem);
    }
    const text = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.label.texture, transparent: true, toneMapped: false }));
    text.scale.set(1.3, 0.65, 1);
    text.position.set(-0.85, 0.45, 0);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(MANA_STEP * 10 + 0.4, 0.8), flashMaterial());
    this.flash.rotation.x = -Math.PI / 2;
    this.flash.position.set(MANA_STEP * 4.5, 0.03, 0);
    this.add(text, this.flash);
  }

  set(m: ManaSnapshot): void {
    const key = `${m.current}/${m.max}/${m.temp}`;
    if (key === this.last) return;
    this.last = key;
    this.gems.forEach((gem, i) => {
      let mat = gemMats.locked;
      if (i < m.current) mat = i >= m.current - m.temp ? gemMats.temp : gemMats.full;
      else if (i < m.max) mat = gemMats.spent;
      gem.material = mat;
      markBloom(gem, mat === gemMats.full || mat === gemMats.temp);
      gem.scale.setScalar(i < Math.max(m.max, m.current) ? 1 : 0.6);
      gem.scale.y *= 1.4;
    });
    const g = this.label.g;
    g.clearRect(0, 0, 192, 96);
    strokeText(g, `${m.current}/${m.max}`, 96, 50, 58, '#cfe6ff', FONT_CN, 0.14);
    this.label.texture.needsUpdate = true;
  }

  tick(t: number): void {
    this.gems.forEach((gem, i) => (gem.rotation.y = t * 0.8 + i * 0.4));
  }
}

const deckCardGeo = shared(new THREE.BoxGeometry(1.5, 1, 2.1));
const deckSideMat = shared(new THREE.MeshStandardMaterial({ color: 0xd8ceb0, roughness: 0.8 }));
const deckTopMat = shared(new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.55 }));

// 牌库：一叠卡背，厚度随剩余张数变。悬停显示张数。
export class DeckView extends THREE.Group {
  private readonly stack: THREE.Mesh;
  private tip: THREE.Sprite | null = null;
  private cardCount = -1;
  private fatigue = 0;

  constructor(side: 0 | 1) {
    super();
    this.stack = new THREE.Mesh(deckCardGeo, [deckSideMat, deckSideMat, deckTopMat, deckSideMat, deckSideMat, deckSideMat]);
    this.stack.castShadow = true;
    this.stack.receiveShadow = true;
    this.add(this.stack);
    this.userData.pick = { kind: 'deck', side };
  }

  set(count: number, fatigue: number): void {
    if (count === this.cardCount && fatigue === this.fatigue) return;
    this.cardCount = count;
    this.fatigue = fatigue;
    const h = Math.max(0.02, count * 0.022);
    this.stack.scale.y = h;
    this.stack.position.y = h / 2;
    this.stack.visible = count > 0;
    if (this.tip) this.showCount(true);
  }

  showCount(on: boolean): void {
    if (this.tip) {
      this.tip.removeFromParent();
      this.tip.material.map?.dispose();
      this.tip.material.dispose();
      this.tip = null;
    }
    if (!on) return;
    const text = this.cardCount > 0 ? `牌库 ${this.cardCount} 张` : `牌库空 疲劳 ${this.fatigue}`;
    this.tip = textSprite(text, 0xf0e6d2, 0.36, FONT_CN, true);
    this.tip.position.set(0, 1.4, 0);
    this.add(this.tip);
  }
}

const buttonGeo = shared(new THREE.CylinderGeometry(1, 1.08, 0.36, 4));
const buttonTopGeo = shared(new THREE.PlaneGeometry(1.9, 1.0));

// 结束回合按钮：海克斯风格的菱形实体按钮，立在台面右侧。我方回合亮起并缓慢脉动，对方回合变暗显示"对方回合"。
export class EndTurnButton extends THREE.Group {
  readonly body = new THREE.Group();
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly label = makeLabelCanvas(384, 200);
  private pulse: gsap.core.Tween | null = null;
  private key = '';
  mode: 'mine' | 'theirs' | 'off' = 'off';

  constructor() {
    super();
    this.mat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.35, metalness: 0.6, emissive: 0x000000 });
    const prism = new THREE.Mesh(buttonGeo, this.mat);
    prism.rotation.y = Math.PI / 4;
    prism.scale.set(1.25, 1, 0.75);
    prism.position.y = 0.18;
    prism.castShadow = true;
    const top = new THREE.Mesh(buttonTopGeo, new THREE.MeshBasicMaterial({ map: this.label.texture, transparent: true, toneMapped: false }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.37;
    this.body.add(prism, top);
    this.add(this.body);
    this.userData.pick = { kind: 'end_turn' };
    this.setMode('off', false);
  }

  setMode(mode: 'mine' | 'theirs' | 'off', ready: boolean): void {
    const key = `${mode}${ready}`;
    if (key === this.key) return;
    this.key = key;
    this.mode = mode;
    const mine = mode === 'mine';
    this.mat.color.setHex(mine ? (ready ? 0x2fbf4f : 0xc8aa6e) : 0x3a3a3a);
    this.mat.emissive.setHex(mine ? (ready ? 0x1a8a30 : 0x6a5020) : 0x000000);
    this.mat.emissiveIntensity = mine ? 0.8 : 0;
    const g = this.label.g;
    g.clearRect(0, 0, 384, 200);
    strokeText(g, mode === 'theirs' ? '对方回合' : '结束回合', 192, 104, 74, mine ? '#ffffff' : '#9a9a9a', FONT_CN, 0.12);
    this.label.texture.needsUpdate = true;
    if (mine && !this.pulse) {
      this.pulse = gsap.to(this.body.scale, { x: 1.06, y: 1.06, z: 1.06, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    } else if (!mine && this.pulse) {
      this.pulse.kill();
      this.pulse = null;
      this.body.scale.setScalar(1);
    }
  }
}

// 对方思考中的提示
export class ThinkingView extends THREE.Group {
  constructor() {
    super();
    const s = textSprite('对方思考中…', 0xe0e0e0, 0.34, FONT_CN, true);
    this.add(s);
    this.visible = false;
  }
}

