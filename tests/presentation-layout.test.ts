// 布局在画面上的位置：用真实的镜头参数把槽位投影到 1920×1080 的画面上，核对互相不遮挡（spec 5.2、5.4）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ASPECT,
  CAMERA,
  CARD_H,
  CARD_W,
  handSlot,
  heroPowerSlot,
  heroSlot,
  MANA_STEP,
  manaSlot,
  NEXUS,
  type Placement,
  type Slot,
} from '../src/presentation/layout';

const W = 1920;
const H = 1080;

type Box = { x0: number; y0: number; x1: number; y1: number };

const camera = (() => {
  const c = new THREE.PerspectiveCamera(CAMERA.fov, ASPECT, 0.1, 100);
  c.position.set(CAMERA.pos.x, CAMERA.pos.y, CAMERA.pos.z);
  c.lookAt(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);
  c.updateMatrixWorld();
  return c;
})();

function project(v: THREE.Vector3): { x: number; y: number } {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
}

function boxOf(points: THREE.Vector3[]): Box {
  const ps = points.map(project);
  return {
    x0: Math.min(...ps.map((p) => p.x)),
    y0: Math.min(...ps.map((p) => p.y)),
    x1: Math.max(...ps.map((p) => p.x)),
    y1: Math.max(...ps.map((p) => p.y)),
  };
}

function matrixOf(s: Slot): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(s.rot.x, s.rot.y, s.rot.z)),
    new THREE.Vector3(s.scale, s.scale, s.scale),
  );
}

function cardBox(s: Slot): Box {
  const m = matrixOf(s);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => new THREE.Vector3((x * CARD_W) / 2, (y * CARD_H) / 2, 0).applyMatrix4(m));
  return boxOf(corners);
}

// 一个世界坐标点周围半径 r 的球在画面上的范围
function sphereBox(p: THREE.Vector3, r: number): Box {
  const pts: THREE.Vector3[] = [];
  for (const d of [-r, r]) pts.push(p.clone().add(new THREE.Vector3(d, 0, 0)), p.clone().add(new THREE.Vector3(0, d, 0)), p.clone().add(new THREE.Vector3(0, 0, d)));
  return boxOf(pts);
}

function nexusHpBox(p: Placement): Box {
  const h = heroSlot(p).pos;
  return sphereBox(new THREE.Vector3(h.x + NEXUS.hpPos.x, h.y + NEXUS.hpPos.y, h.z + NEXUS.hpPos.z), NEXUS.hpRadius);
}

function nexusDiscBox(p: Placement): Box {
  const h = heroSlot(p).pos;
  return sphereBox(new THREE.Vector3(h.x + NEXUS.discPos.x, h.y + NEXUS.discPos.y, h.z + NEXUS.discPos.z), NEXUS.discRadius);
}

function heroPowerBox(p: Placement): Box {
  const s = heroPowerSlot(p).pos;
  return sphereBox(new THREE.Vector3(s.x, 0.2, s.z), 0.66);
}

function manaBox(p: Placement): Box {
  const s = manaSlot(p).pos;
  // 10 颗宝石加左边的数字标签
  return boxOf([
    new THREE.Vector3(s.x - 1.5, 0.8, s.z - 0.3),
    new THREE.Vector3(s.x - 1.5, 0, s.z + 0.3),
    new THREE.Vector3(s.x + 9 * MANA_STEP + 0.3, 0.8, s.z - 0.3),
    new THREE.Vector3(s.x + 9 * MANA_STEP + 0.3, 0, s.z + 0.3),
  ]);
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('布局', () => {
  it('我方手牌 1 到 10 张、不悬停时，不挡双方的生命数字、英雄技能、法力条', () => {
    const keep: [string, Box][] = [];
    for (const p of ['near', 'far'] as Placement[]) {
      keep.push([`${p} 生命数字`, nexusHpBox(p)], [`${p} 头像`, nexusDiscBox(p)], [`${p} 英雄技能`, heroPowerBox(p)], [`${p} 法力条`, manaBox(p)]);
    }
    for (let n = 1; n <= 10; n++) {
      for (let i = 0; i < n; i++) {
        const card = cardBox(handSlot('near', i, n));
        for (const [name, box] of keep) expect(overlaps(card, box), `${n} 张手牌的第 ${i} 张挡住了${name}`).toBe(false);
      }
    }
  });

  it('关键物件都在画面里', () => {
    for (const p of ['near', 'far'] as Placement[]) {
      for (const b of [nexusHpBox(p), heroPowerBox(p), manaBox(p)]) {
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.x1).toBeLessThanOrEqual(W);
        expect(b.y0).toBeGreaterThanOrEqual(0);
        expect(b.y1).toBeLessThanOrEqual(H);
      }
    }
  });

  it('我方手牌露出卡面上半部分（费用、名字）；对方手牌不被画面上边缘裁掉', () => {
    for (let n = 1; n <= 10; n++) {
      for (let i = 0; i < n; i++) {
        const b = cardBox(handSlot('near', i, n));
        // 卡面上 45% 在画面里：费用六边形、原画、名字横幅
        expect(b.y0 + (b.y1 - b.y0) * 0.45).toBeLessThan(H);
        expect(cardBox(handSlot('far', i, n)).y0).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('地形', () => {
  it('随从行、枢纽、英雄技能、牌库、法力条、结束回合按钮脚下是平的', async () => {
    const { terrainHeight } = await import('../src/scene/terrain');
    const { boardSlot, deckSlot, endTurnSlot } = await import('../src/presentation/layout');
    const flatAt = (x: number, z: number, what: string) => expect(Math.abs(terrainHeight(x, z)), `${what} (${x.toFixed(2)}, ${z.toFixed(2)})`).toBeLessThan(0.03);
    for (const p of ['near', 'far'] as Placement[]) {
      const rz = boardSlot(p, 0, 1).pos.z;
      for (let x = -7; x <= 7; x += 0.25) for (const dz of [-0.8, 0, 0.8]) flatAt(x, rz + dz, `${p} 随从行`);
      for (const [name, s, r] of [
        ['枢纽', heroSlot(p).pos, 1.3],
        ['英雄技能', heroPowerSlot(p).pos, 0.6],
        ['牌库', deckSlot(p).pos, 1.0],
      ] as const) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) flatAt(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, `${p} ${name}`);
      }
      const m = manaSlot(p).pos;
      for (let i = 0; i < 10; i++) flatAt(m.x + i * MANA_STEP, m.z, `${p} 法力条`);
    }
    const e = endTurnSlot().pos;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) flatAt(e.x + Math.cos(a) * 1.0, e.z + Math.sin(a) * 1.0, '结束回合按钮');
  });

  it('河道是挖下去的，左侧野区有起伏', async () => {
    const { terrainHeight, riverCenter, RIVER_DEPTH } = await import('../src/scene/terrain');
    expect(terrainHeight(0, riverCenter(0))).toBeLessThan(-RIVER_DEPTH * 0.8);
    let max = 0;
    for (let z = -5; z <= 5; z += 0.5) max = Math.max(max, terrainHeight(-9.6, z));
    expect(max).toBeGreaterThan(0.3);
  });
});
