// 共用的几何体：同一种物件的所有实例共用一份，不随物件销毁。
import * as THREE from 'three';
import { CARD_H, CARD_T, CARD_W, MINION_HEIGHT, MINION_SIZE } from '../presentation/layout';
import { shared } from './dispose';

export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// ShapeGeometry 的 UV 是形状坐标，换成 0..1，贴图才能铺满
function normalizeUv(geo: THREE.BufferGeometry, w: number, h: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / w + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / h + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const cardShape = roundedRect(CARD_W, CARD_H, 0.12);

// 卡牌：有厚度的圆角薄板，正反两面各一张贴图面片。
export const CARD_BODY = shared((() => {
  // 边缘带一点倒角，厚度边在斜着看时能看出来
  const b = 0.012;
  const g = new THREE.ExtrudeGeometry(roundedRect(CARD_W - b * 2, CARD_H - b * 2, 0.11), {
    depth: CARD_T - b * 2,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.translate(0, 0, -CARD_T / 2 + b);
  return g;
})());
// 卡面上凸起的边框：一圈带倒角的金属框，斜着看、转动时高光沿着它流动
export const CARD_FRAME = shared((() => {
  const outer = roundedRect(CARD_W - 0.01, CARD_H - 0.01, 0.115);
  outer.holes.push(roundedRect(CARD_W - 0.11, CARD_H - 0.11, 0.08));
  const b = 0.01;
  return new THREE.ExtrudeGeometry(outer, { depth: 0.012, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 2, curveSegments: 6 });
})());
export const CARD_FACE = shared(normalizeUv(new THREE.ShapeGeometry(cardShape, 6), CARD_W, CARD_H));
// 发光边：比卡牌大一圈的圆角面片，放在卡牌背后
export const CARD_GLOW = shared(new THREE.ShapeGeometry(roundedRect(CARD_W + 0.14, CARD_H + 0.14, 0.17), 6));

// 随从底座：带倒角的圆角方块，顶面在 y = MINION_HEIGHT
export const MINION_BASE = shared((() => {
  const bevel = 0.05;
  const g = new THREE.ExtrudeGeometry(roundedRect(MINION_SIZE - bevel * 2, MINION_SIZE - bevel * 2, 0.14), {
    depth: MINION_HEIGHT - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
})());
export const MINION_TOP = shared(new THREE.PlaneGeometry(MINION_SIZE - 0.2, MINION_SIZE - 0.2));
// 底座外的一圈描边（嘲讽金边、能攻击的绿边、可选目标的红边）
export const MINION_RIM = shared((() => {
  const outer = roundedRect(MINION_SIZE + 0.26, MINION_SIZE + 0.26, 0.22);
  outer.holes.push(roundedRect(MINION_SIZE + 0.02, MINION_SIZE + 0.02, 0.16));
  const g = new THREE.ExtrudeGeometry(outer, { depth: 0.08, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
})());
// 选目标时合法目标的细边：比 MINION_RIM 窄一半、矮一些，贴着底座外沿
export const MINION_TARGET_RIM = shared((() => {
  const outer = roundedRect(MINION_SIZE + 0.16, MINION_SIZE + 0.16, 0.2);
  outer.holes.push(roundedRect(MINION_SIZE + 0.04, MINION_SIZE + 0.04, 0.17));
  const g = new THREE.ExtrudeGeometry(outer, { depth: 0.05, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
})());
export const UNIT_BOX = shared(new THREE.BoxGeometry(1, 1, 1));
export const UNIT_SPHERE = shared(new THREE.SphereGeometry(1, 24, 16));
