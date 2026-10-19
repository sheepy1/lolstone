// 卡牌（spec 5.4）：有厚度的圆角薄板，正面是 canvas 合成的卡面贴图（原画、海克斯边框、费用六边形、
// 名字、文本），背面是卡背。看不到的牌两面都是卡背。能出的牌背后有一圈发光边（bloom）。
import * as THREE from 'three';
import { getCard, HIDDEN_CARD_ID } from '../engine';
import { CARD_T } from '../presentation/layout';
import { EDGE_GLOW, glowMaterial } from '../presentation/fx/materials';
import { cardBackTexture, cardFaceTexture } from './canvasArt';
import { CARD_BODY, CARD_FACE, CARD_GLOW } from './geometry';
import { COLORS } from './theme';
import { shared } from './dispose';

const bodyMat = shared(new THREE.MeshStandardMaterial({ color: 0x8a7650, roughness: 0.6, metalness: 0.3 }));
const backMat = shared(new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.55, metalness: 0.15 }));
// 发光边的亮度低于 bloom 阈值：只有边框本身亮，不往卡面上泛光
const glowMat = shared(glowMaterial(COLORS.playable, EDGE_GLOW));
const markMat = shared((() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ff4040';
  g.lineWidth = 16;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(34, 34);
  g.lineTo(94, 94);
  g.moveTo(94, 34);
  g.lineTo(34, 94);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
})());
const markGeo = shared(new THREE.PlaneGeometry(0.9, 0.9));

export class CardView extends THREE.Group {
  readonly instanceId: number;
  cardId = '';
  // 动画在 body 上做局部的抖动、倾斜，外层 Group 的变换归布局管
  readonly body = new THREE.Group();
  private readonly front: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly glow: THREE.Mesh;
  private readonly mark: THREE.Mesh;
  private dimmed = false;

  constructor(instanceId: number, cardId: string) {
    super();
    this.instanceId = instanceId;
    const slab = new THREE.Mesh(CARD_BODY, bodyMat);
    slab.castShadow = true;
    // 卡面材质每张牌一份（变暗、烧红只改自己），贴图按卡牌 id 共用
    this.front = new THREE.Mesh(CARD_FACE, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }));
    this.front.position.z = CARD_T / 2 + 0.002;
    const back = new THREE.Mesh(CARD_FACE, backMat);
    back.position.z = -CARD_T / 2 - 0.002;
    back.rotation.y = Math.PI;
    this.glow = new THREE.Mesh(CARD_GLOW, glowMat);
    this.glow.position.z = -CARD_T / 2 - 0.006;
    this.glow.visible = false;
    this.mark = new THREE.Mesh(markGeo, markMat);
    this.mark.position.set(0, 0.3, CARD_T / 2 + 0.01);
    this.mark.visible = false;
    this.body.add(this.glow, slab, this.front, back, this.mark);
    this.add(this.body);
    this.userData.pick = { kind: 'hand', id: instanceId };
    this.setCard(cardId);
  }

  get hidden(): boolean {
    return this.cardId === HIDDEN_CARD_ID;
  }

  setCard(cardId: string): void {
    if (cardId === this.cardId) return;
    this.cardId = cardId;
    if (cardId !== HIDDEN_CARD_ID) getCard(cardId);
    this.front.material.map = cardId === HIDDEN_CARD_ID ? cardBackTexture() : cardFaceTexture(cardId);
    this.front.material.needsUpdate = true;
  }

  setHighlight(on: boolean): void {
    this.glow.visible = on;
  }

  // 费用不够的牌变暗
  setDim(on: boolean): void {
    if (on === this.dimmed) return;
    this.dimmed = on;
    this.front.material.color.setScalar(on ? 0.45 : 1);
  }

  setMarked(on: boolean): void {
    this.mark.visible = on;
  }

  // 爆牌时烧红
  setBurning(): void {
    this.front.material.color.setRGB(1.6, 0.6, 0.25);
    this.front.material.emissive.setHex(0x802000);
  }
}
