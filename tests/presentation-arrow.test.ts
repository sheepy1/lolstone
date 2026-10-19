// 目标箭头（src/presentation/fx/arrow.ts）：颜色按用途，弧线越过中间的随从、不贴地穿过去。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getCard } from '../src/engine';
import { arcControls, arrowTone, bezier } from '../src/presentation/fx/arrow';
import { boardRowZ, boardSlot, heroSlot, MINION_HEIGHT, MINION_SIZE } from '../src/presentation/layout';

describe('箭头颜色', () => {
  it('随从攻击是伤害色', () => {
    expect(arrowTone('attack', null)).toBe('damage');
  });

  it.each([
    ['demacia.iron_oath', 'buff'], // 使一个友方随从获得 +2/+2
    ['ionia.spirit_rush', 'damage'], // 对一个随从造成 3 点伤害
    ['freljord.crystal_arrow', 'frost'], // 造成 3 点伤害并冻结
    ['freljord.hero_power', 'frost'], // 寒冰箭：冻结一个敌方随从
    ['ionia.hero_power', 'damage'], // 灵魄：造成 1 点伤害
    ['demacia.kayle', 'buff'], // 战吼：使一个友方随从获得圣盾
  ])('%s → %s', (id, tone) => {
    expect(arrowTone('card', getCard(id))).toBe(tone);
  });

  it('没有作用在选中目标上的动作时用默认红', () => {
    expect(arrowTone('card', null)).toBe('default');
  });
});

describe('箭头弧线', () => {
  const ctrl: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const p = new THREE.Vector3();

  // 弧线经过某个随从底座正上方时的最低高度
  function clearanceOver(from: THREE.Vector3, to: THREE.Vector3, minion: { x: number; z: number }): number {
    arcControls(from, to, ctrl);
    let lowest = Infinity;
    for (let i = 0; i <= 200; i++) {
      bezier(ctrl, i / 200, p);
      if (Math.abs(p.x - minion.x) < MINION_SIZE / 2 && Math.abs(p.z - minion.z) < MINION_SIZE / 2) lowest = Math.min(lowest, p.y);
    }
    return lowest;
  }

  it('从我方随从打对方英雄：越过对方随从行时高出底座', () => {
    const from = new THREE.Vector3(-3, 0.5, boardRowZ('near'));
    const hero = heroSlot('far').pos;
    const to = new THREE.Vector3(hero.x, 0.66, hero.z);
    for (let i = 0; i < 7; i++) {
      const s = boardSlot('far', i, 7).pos;
      const h = clearanceOver(from, to, s);
      if (h !== Infinity) expect(h, `对方第 ${i} 个随从上方`).toBeGreaterThan(MINION_HEIGHT + 0.5);
    }
  });

  it('打对方行另一头的随从：越过中间的随从', () => {
    const from = new THREE.Vector3(-4.5, 0.5, boardRowZ('near'));
    const target = boardSlot('far', 6, 7).pos;
    const to = new THREE.Vector3(target.x, 0.35, target.z);
    for (let i = 1; i < 6; i++) {
      const s = boardSlot('far', i, 7).pos;
      const h = clearanceOver(from, to, s);
      if (h !== Infinity) expect(h, `对方第 ${i} 个随从上方`).toBeGreaterThan(MINION_HEIGHT + 0.3);
    }
  });

  it('起点和终点不变，弧线中段明显抬高，距离越远拱得越高', () => {
    const a = new THREE.Vector3(0, 0.5, 1.3);
    const near = new THREE.Vector3(1.5, 0.35, -1.3);
    const far = new THREE.Vector3(6, 0.35, -1.3);
    arcControls(a, near, ctrl);
    expect(bezier(ctrl, 0, p).distanceTo(a)).toBeCloseTo(0);
    expect(bezier(ctrl, 1, p).distanceTo(near)).toBeCloseTo(0);
    const hNear = bezier(ctrl, 0.5, p).y;
    arcControls(a, far, ctrl);
    const hFar = bezier(ctrl, 0.5, p).y;
    expect(hNear).toBeGreaterThan(1.2);
    expect(hFar).toBeGreaterThan(hNear);
  });
});
