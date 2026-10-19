// 台面上的实体物件：法力水晶条、牌库、对方思考提示（棋盘在 board.ts，结束回合按钮在 endTurnButton.ts）。占位几何体，M4 换素材。
import gsap from 'gsap';
import * as THREE from 'three';
import type { ManaSnapshot } from '../engine';
import { MANA_STEP } from '../presentation/layout';
import { flashMaterial, markBloom } from '../presentation/fx/materials';
import { textSprite } from '../presentation/fx/effects';
import { cardBackTexture, makeLabelCanvas, strokeText } from './canvasArt';
import { COLORS, FONT_CN } from './theme';
import { releaseTexture, shared } from './dispose';

const gemGeo = shared(new THREE.OctahedronGeometry(0.2, 0));
const socketGeo = shared(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 8));
const gemMats = {
  full: shared(new THREE.MeshStandardMaterial({ color: 0x3a8cff, emissive: COLORS.mana, emissiveIntensity: 1.6, roughness: 0.2, flatShading: true })),
  // 临时法力（法力药水）：紫色（m4-storyboard E25）
  temp: shared(new THREE.MeshStandardMaterial({ color: 0xb07cff, emissive: 0x9a4dff, emissiveIntensity: 1.6, roughness: 0.2, flatShading: true })),
  spent: shared(new THREE.MeshStandardMaterial({ color: 0x1a2a40, emissive: 0x0a1428, emissiveIntensity: 0.3, roughness: 0.4, flatShading: true })),
  locked: shared(new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.7, transparent: true, opacity: 0.35, flatShading: true })),
};
type GemState = 'full' | 'temp' | 'spent' | 'locked';

// E25 的参数（调试台可调）
export const MANA_FX = { stagger: 0.05, light: 0.2 };

const socketMat = shared(new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.6, metalness: 0.5 }));

// 法力条：10 颗水晶立在台面上。可用的亮（自发光进 bloom），用掉的暗，临时法力另一种颜色，未解锁的熄灭变小。
// 法力变化（m4-storyboard E25）：set(m, true) 时变化的格子从左往右 50ms 错开换状态，亮起的自发光从 0 到 1、弹一下；
// 新解锁的空水晶从 0 放大出现。每颗水晶有自己的一份材质，亮度动画只改自己。
export class ManaBarView extends THREE.Group {
  readonly flash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly gems: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  private states: GemState[] = Array(10).fill('locked');
  private readonly label = makeLabelCanvas(192, 96);
  private last = '';

  constructor() {
    super();
    for (let i = 0; i < 10; i++) {
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.position.set(i * MANA_STEP, 0.04, 0);
      socket.receiveShadow = true;
      const gem = new THREE.Mesh(gemGeo, gemMats.locked.clone());
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

  set(m: ManaSnapshot, animate = false): void {
    const key = `${m.current}/${m.max}/${m.temp}`;
    if (key === this.last) return;
    this.last = key;
    const next: GemState[] = this.gems.map((_, i) => (i < m.current ? (i >= m.current - m.temp ? 'temp' : 'full') : i < m.max ? 'spent' : 'locked'));
    let k = 0;
    this.gems.forEach((gem, i) => {
      const prev = this.states[i];
      const to = next[i];
      const size = to === 'locked' ? 0.6 : 1;
      const apply = () => {
        gem.material.copy(gemMats[to]);
        markBloom(gem, to === 'full' || to === 'temp');
        gem.scale.set(size, size * 1.4, size);
      };
      gsap.killTweensOf([gem.scale, gem.material]);
      if (!animate || prev === to) {
        apply();
        return;
      }
      // 变化的格子从左往右错开
      gsap.delayedCall(k++ * MANA_FX.stagger, () => {
        apply();
        if (to === 'full' || to === 'temp') {
          gsap.fromTo(gem.material, { emissiveIntensity: 0 }, { emissiveIntensity: gemMats[to].emissiveIntensity, duration: MANA_FX.light, ease: 'power2.out' });
        }
        // 新解锁的空水晶从 0 放大出现；其余变化的弹一下
        const from = prev === 'locked' ? 0.01 : size * 1.3;
        gsap.fromTo(gem.scale, { x: from, y: from * 1.4, z: from }, { x: size, y: size * 1.4, z: size, duration: MANA_FX.light * (prev === 'locked' ? 1.5 : 1), ease: 'back.out(2)' });
      });
    });
    this.states = next;
    const g = this.label.g;
    g.clearRect(0, 0, 192, 96);
    strokeText(g, `${m.current}/${m.max}`, 96, 50, 58, '#cfe6ff', FONT_CN, 0.14);
    this.label.texture.needsUpdate = true;
  }

  // 第 i 颗水晶在世界里的位置（法力变化的粒子用）
  gemPoint(i: number): THREE.Vector3 {
    return this.gems[i].getWorldPosition(new THREE.Vector3());
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
      if (this.tip.material.map) releaseTexture(this.tip.material.map);
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

// 对方思考中的提示
export class ThinkingView extends THREE.Group {
  constructor() {
    super();
    const s = textSprite('对方思考中…', 0xe0e0e0, 0.34, FONT_CN, true);
    this.add(s);
    this.visible = false;
  }
}

