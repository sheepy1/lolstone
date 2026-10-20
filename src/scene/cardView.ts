// 卡牌（spec 5.4）：有厚度的圆角薄板，正面是 canvas 合成的卡面贴图（原画、海克斯边框、费用六边形、
// 名字、文本），背面是卡背。看不到的牌两面都是卡背。能出的牌背后有一圈发光边（bloom）。
import * as THREE from 'three';
import { getCard, HIDDEN_CARD_ID } from '../engine';
import { CARD_T } from '../presentation/layout';
import { EDGE_GLOW, glowMaterial, markBloom } from '../presentation/fx/materials';
import { cardBackTexture, cardFaceTexture } from './canvasArt';
import { ART_STYLE } from './artStyle';
import { cardFaceMaps, faceLayout } from './cardFrameArt';
import { CardTexts, type CardStats } from './cardText';
import { CARD_BODY, CARD_FACE, CARD_FRAME, CARD_GLOW, CARD_HERO_CREST } from './geometry';
import { COLORS, REGION_COLORS } from './theme';
import type { CardClass } from '../engine';
import { shared } from './dispose';

const NEW_ART = ART_STYLE === 'new';
const bodyMat = shared(new THREE.MeshStandardMaterial({ color: 0x8a7650, roughness: 0.6, metalness: 0.3 }));
// 卡背的材质（新版带法线、粗糙度金属度贴图和反射），牌库顶面也用它
export const backMat = shared(
  NEW_ART
    ? new THREE.MeshStandardMaterial({ map: cardBackTexture(), ...faceMapProps('back'), roughness: 1, metalness: 1 })
    : new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.55, metalness: 0.15 }),
);

// 新版卡面的法线、粗糙度、金属度贴图（按版式共用，cardFrameArt.ts）
function faceMapProps(layout: ReturnType<typeof faceLayout>) {
  const m = cardFaceMaps(layout);
  return { normalMap: m.normal, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: m.rm, metalnessMap: m.rm };
}

// 金属边框、卡背、卡面上的金属部分反射舞台的 reflections（和结束回合按钮的金色金属一样），
// 没有反射环境时金属只剩一块暗色，看不出是金属。只用它的镜面反射（specularOnly）
let reflections: THREE.Texture | null = null;
const reflective = new Set<THREE.MeshStandardMaterial>();
export function useCardReflections(env: THREE.Texture): void {
  if (!NEW_ART || reflections === env) return;
  reflections = env;
  for (const m of reflective) applyReflections(m);
}
// 反射贴图只给金属部分：three 默认拿它算漫反射的环境光（irradiance），非金属的表面（原画、文本框、宝石）和清漆层
// 也照样反射它。它是一间亮着灯的房间，强度压到 0.18 也会给整张卡面蒙一层灰白，悬停抬起的牌最明显，原画、宝石颜色发淡。
// 这里去掉环境漫反射和清漆的环境反射，镜面反射乘金属度：边框、包边这些金属有反光，其余只受场景灯光
function specularOnly(m: THREE.MeshStandardMaterial): void {
  if (m.userData.specularOnly) return;
  m.userData.specularOnly = true;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <lights_fragment_maps>',
      THREE.ShaderChunk.lights_fragment_maps
        .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '')
        .replace('radiance += iblRadiance;', 'radiance += iblRadiance * metalnessFactor;')
        .replace('clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );', ''),
    );
  };
  m.customProgramCacheKey = () => 'lolstone-card-metal-env';
}

function applyReflections(m: THREE.MeshStandardMaterial, intensity = m.userData.envIntensity ?? 0.7): void {
  specularOnly(m);
  reflective.add(m);
  m.userData.envIntensity = intensity;
  if (!reflections || m.envMap === reflections) return;
  m.envMap = reflections;
  m.envMapIntensity = intensity;
  m.needsUpdate = true;
}
if (NEW_ART) applyReflections(backMat, 0.6);

// 发光边的亮度低于 bloom 阈值：只有边框本身亮，不往卡面上泛光
export const glowMat = shared(glowMaterial(COLORS.playable, EDGE_GLOW));
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
// 凸起边框的金属材质：按地区配色，五个地区加卡背各一份。新版里英雄卡和非英雄卡各一份：英雄卡亮、光滑，
// 非英雄卡暗一些、粗一些（素边框）
const frameMats = new Map<string, THREE.MeshStandardMaterial>();
function frameMat(key: CardClass | 'back', hero = false): THREE.MeshStandardMaterial {
  const id = `${key}|${hero}`;
  let m = frameMats.get(id);
  if (!m) {
    const color = key === 'back' ? 0xc8aa6e : REGION_COLORS[key].frame;
    if (!NEW_ART) m = shared(new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.28 }));
    else {
      const c = new THREE.Color(key === 'noxus' ? 0x3a2f31 : color);
      if (!hero && key !== 'back') c.multiplyScalar(0.72);
      m = shared(new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: hero || key === 'back' ? 0.24 : 0.38 }));
      applyReflections(m, hero || key === 'back' ? 0.55 : 0.35);
    }
    frameMats.set(id, m);
  }
  return m;
}
// 英雄卡顶上冠饰的金属件和中间的宝石（3D 凸起，和底图上画的冠饰对齐）
const crestMats = new Map<CardClass, [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]>();
function crestMat(cls: CardClass): [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
  let m = crestMats.get(cls);
  if (!m) {
    // 中立的强调色是石灰，和边框分不开，换成海克斯金
    const accent = cls === 'neutral' ? COLORS.hexGold : REGION_COLORS[cls].accent;
    const metal = shared(new THREE.MeshStandardMaterial({ color: accent, metalness: 0.9, roughness: 0.25 }));
    const gem = shared(new THREE.MeshPhysicalMaterial({ color: accent, metalness: 0.1, roughness: 0.1, clearcoat: 1, emissive: accent, emissiveIntensity: 0.25 }));
    applyReflections(metal, 0.6);
    applyReflections(gem, 0.6);
    m = [metal, gem];
    crestMats.set(cls, m);
  }
  return m;
}

export class CardView extends THREE.Group {
  readonly instanceId: number;
  cardId = '';
  // 动画在 body 上做局部的抖动、倾斜，外层 Group 的变换归布局管
  readonly body = new THREE.Group();
  private readonly front: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private readonly frame: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  // 英雄卡的冠饰和内侧细框（只有新版的英雄卡显示）
  private readonly crest: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly crestGem: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly heroRim: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly glow: THREE.Mesh;
  private readonly mark: THREE.Mesh;
  private dimmed = false;
  private matte = false;
  private readonly texts: CardTexts;

  constructor(instanceId: number, cardId: string) {
    super();
    this.instanceId = instanceId;
    const slab = new THREE.Mesh(CARD_BODY, bodyMat);
    slab.castShadow = true;
    // 卡面材质每张牌一份（变暗、烧红只改自己），贴图按卡牌 id 共用
    // 卡面有一层清漆：高光随视角移动，转动时光线在卡面上流动
    // 新版的卡面带法线、粗糙度、金属度贴图，粗糙度和金属度由贴图给，材质上的系数是 1
    this.front = new THREE.Mesh(
      CARD_FACE,
      NEW_ART
        ? new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 1, clearcoat: 0.4, clearcoatRoughness: 0.25 })
        : new THREE.MeshPhysicalMaterial({ roughness: 0.55, metalness: 0.05, clearcoat: 0.75, clearcoatRoughness: 0.2 }),
    );
    if (NEW_ART) applyReflections(this.front.material, 0.5);
    this.front.position.z = CARD_T / 2 + 0.002;
    const back = new THREE.Mesh(CARD_FACE, backMat);
    back.position.z = -CARD_T / 2 - 0.002;
    back.rotation.y = Math.PI;
    this.glow = new THREE.Mesh(CARD_GLOW, glowMat);
    this.glow.position.z = -CARD_T / 2 - 0.006;
    this.glow.visible = false;
    markBloom(this.glow);
    this.mark = new THREE.Mesh(markGeo, markMat);
    this.mark.position.set(0, 0.3, CARD_T / 2 + 0.01);
    this.mark.visible = false;
    this.frame = new THREE.Mesh(CARD_FRAME, frameMat('back'));
    this.frame.position.z = CARD_T / 2 - 0.004;
    this.frame.castShadow = true;
    this.crest = new THREE.Mesh(CARD_HERO_CREST.metal, frameMat('back'));
    this.crestGem = new THREE.Mesh(CARD_HERO_CREST.gem, frameMat('back'));
    this.heroRim = new THREE.Mesh(CARD_HERO_CREST.rim, frameMat('back'));
    this.crest.visible = this.crestGem.visible = this.heroRim.visible = false;
    this.body.add(this.glow, slab, this.front, back, this.frame, this.crest, this.crestGem, this.heroRim, this.mark);
    this.texts = new CardTexts(this.body);
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
    const def = cardId === HIDDEN_CARD_ID ? null : getCard(cardId);
    const m = this.front.material;
    m.map = def ? cardFaceTexture(cardId) : cardBackTexture();
    this.frame.material = frameMat(def ? def.class : 'back', !!def?.champion);
    if (NEW_ART) {
      Object.assign(m, faceMapProps(faceLayout(def)));
      if (this.matte) Object.assign(m, { roughnessMap: null, metalnessMap: null });
      const hero = !!def?.champion;
      this.crest.visible = this.crestGem.visible = this.heroRim.visible = hero;
      if (def && hero) {
        [this.crest.material, this.crestGem.material] = crestMat(def.class);
        this.heroRim.material = this.crest.material;
      }
    }
    m.needsUpdate = true;
    this.texts.setCard(def ? cardId : null);
  }

  setHighlight(on: boolean): void {
    this.glow.visible = on;
  }

  // 费用不够的牌变暗
  setDim(on: boolean): void {
    if (on === this.dimmed) return;
    this.dimmed = on;
    this.front.material.color.setScalar(on ? 0.45 : 1);
    this.texts.setDim(on);
  }

  // 去掉清漆层。悬停大卡浮在镜头前、正对着方向光的镜面反射方向，清漆把整张卡面照成一片白，原画看不清；
  // 它不需要转动时流动的高光，关掉清漆只留漫反射。
  // 新版的卡面还去掉粗糙度、金属度贴图：金属部分和宝石正对着太阳的镜面方向，会反成一片白，看不出颜色；
  // 法线贴图留着，倒角的明暗还在
  setMatte(): void {
    const m = this.front.material;
    m.clearcoat = 0;
    if (NEW_ART) {
      this.matte = true;
      Object.assign(m, { roughnessMap: null, metalnessMap: null, roughness: 0.75, metalness: 0 });
    }
    m.needsUpdate = true;
  }

  setMarked(on: boolean): void {
    this.mark.visible = on;
  }

  // 场上随从的当前数值（悬停大卡用）
  setStats(stats: CardStats | null): void {
    this.texts.setStats(stats);
  }

  // 法术退场时卡面提亮
  flare(): void {
    this.front.material.emissive.setHex(0xfff1b8);
    this.front.material.emissiveIntensity = 0.7;
  }

  // 爆牌时烧红
  setBurning(): void {
    this.front.material.color.setRGB(1.6, 0.6, 0.25);
    this.front.material.emissive.setHex(0x802000);
  }
}
