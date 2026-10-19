// 台面和台面上的实体物件：棋盘、法力水晶条、牌库、结束回合按钮、对方思考提示。占位几何体，M4 换素材。
import gsap from 'gsap';
import * as THREE from 'three';
import type { ManaSnapshot } from '../engine';
import { MANA_STEP, RIVER_Z, TABLE } from '../presentation/layout';
import { flashMaterial, hdr } from '../presentation/fx/materials';
import { textSprite } from '../presentation/fx/effects';
import { cardBackTexture, makeLabelCanvas, strokeText } from './canvasArt';
import { COLORS, FONT_CN } from './theme';
import { shared } from './dispose';

// 召唤师峡谷俯视图的程序生成占位：草地、两条兵线、中线河道、零星的草丛和石块
function boardTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = Math.round((W * TABLE.depth) / TABLE.width);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#24452f');
  grad.addColorStop(0.5, '#2e5a3a');
  grad.addColorStop(1, '#24452f');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 草地噪点（固定种子，画面稳定）
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${20 + rnd() * 40},${60 + rnd() * 50},${30 + rnd() * 30},0.35)`;
    g.fillRect(rnd() * W, rnd() * H, 3 + rnd() * 6, 3 + rnd() * 6);
  }
  // 两条兵线（随从行）
  const lane = (cy: number) => {
    g.fillStyle = 'rgba(120,100,70,0.35)';
    g.beginPath();
    g.roundRect(W * 0.16, cy - H * 0.09, W * 0.68, H * 0.18, 40);
    g.fill();
    g.strokeStyle = 'rgba(200,170,110,0.35)';
    g.lineWidth = 4;
    g.stroke();
  };
  lane(H * (0.5 - 2.05 / TABLE.depth));
  lane(H * (0.5 + 2.05 / TABLE.depth));
  // 河道
  const ry = H * (0.5 + RIVER_Z / TABLE.depth);
  const river = g.createLinearGradient(0, ry - 60, 0, ry + 60);
  river.addColorStop(0, '#1b4a5c');
  river.addColorStop(0.5, '#2f7d99');
  river.addColorStop(1, '#1b4a5c');
  g.fillStyle = river;
  g.beginPath();
  g.moveTo(0, ry - 50);
  for (let x = 0; x <= W; x += 64) g.lineTo(x, ry - 50 + Math.sin(x / 140) * 14);
  for (let x = W; x >= 0; x -= 64) g.lineTo(x, ry + 50 + Math.sin(x / 160 + 1) * 14);
  g.closePath();
  g.fill();
  // 草丛和石块
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    if (Math.abs(y - ry) < 90) continue;
    g.fillStyle = rnd() > 0.5 ? 'rgba(30,80,40,0.8)' : 'rgba(90,90,80,0.7)';
    g.beginPath();
    g.ellipse(x, y, 20 + rnd() * 40, 12 + rnd() * 24, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 棋盘：有厚度的实体台面，四周一圈凸起的边框，下面一块大地面接阴影。
export class BoardView extends THREE.Group {
  private readonly shine: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    super();
    const { width: W, depth: D, thickness: T } = TABLE;
    const side = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8, metalness: 0.1 });
    const top = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.9, metalness: 0.0 });
    // BoxGeometry 的面顺序：+x -x +y -y +z -z
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, T, D), [side, side, top, side, side, side]);
    slab.position.y = -T / 2;
    slab.receiveShadow = true;
    slab.castShadow = true;
    this.add(slab);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.45, metalness: 0.6 });
    const rail = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), frameMat);
      m.position.set(x, 0.11, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.add(m);
    };
    rail(W + 0.3, 0.3, 0, D / 2);
    rail(W + 0.3, 0.3, 0, -D / 2);
    rail(0.3, D, W / 2, 0);
    rail(0.3, D, -W / 2, 0);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ color: 0x0c1410, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -T - 1.2;
    ground.receiveShadow = true;
    this.add(ground);
    // 河面反光：一条半透明的亮带沿河道缓慢移动（spec 5.2 的环境动画占位）
    this.shine = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.shine.rotation.x = -Math.PI / 2;
    this.shine.position.set(-W / 2, 0.01, RIVER_Z);
    this.add(this.shine);
  }

  tick(t: number): void {
    const W = TABLE.width - 2;
    this.shine.position.x = -W / 2 + ((t * 0.9) % W);
  }
}

const gemGeo = shared(new THREE.OctahedronGeometry(0.2, 0));
const socketGeo = shared(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 8));
const gemMats = {
  full: shared(new THREE.MeshStandardMaterial({ color: 0x3a8cff, emissive: COLORS.mana, emissiveIntensity: 3.2, roughness: 0.2, flatShading: true })),
  temp: shared(new THREE.MeshStandardMaterial({ color: 0x45e0d0, emissive: COLORS.manaTemp, emissiveIntensity: 3.2, roughness: 0.2, flatShading: true })),
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
    this.mat.emissiveIntensity = mine ? 1.4 : 0;
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

