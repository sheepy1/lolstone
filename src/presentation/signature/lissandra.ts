// lissandra.frozen_tomb 丽桑卓 · 1200ms · 重（m4-signature-fx）。战吼的 freeze 一组：
// 举手 0–200（起）：丽桑卓的底座后仰、抬 0.1 底座高；
// 蔓延 200–550（线）：冰从她脚下沿地面向敌方半场爬过去（地面冰按到她的距离长出来，前沿一路冒冰晶）；
// 冰棺 每个 300、至少错开 40（落）：冰爬到哪个敌方随从，冰棺就从下往上包住它：E17 的覆冰外面再罩一层大一号的棺形冰；
// 收尾 250（飘）：地面冰退去，冰棺留下（它挂在冻结的常驻冰层下面，跟着冰层解冻、跟着随从死亡消失）。
// 第一个冰棺合上时 S1、棋盘闪冰色；每个冰棺一声轻的结冰声，第一个叠一声重的。记忆点是冰从她脚下爬过去。
import gsap from 'gsap';
import type * as THREE from 'three';
import type { EventOf } from '../../engine';
import type { MinionView } from '../../scene/minionView';
import type { TableScene } from '../../scene/table';
import { FREEZE, jitter, UNIT } from '../animations/combat';
import { flash } from '../animations/util';
import { SIGNATURE_PRESETS } from '../fx/particles/presets';
import { iceRise } from '../fx/statusFx';
import { at, bigFlash, bigShake, claimTurn, COLOR, EASE, minionOf, sfx, span, temp, towardEnemy } from './kit';
import { makeFrostSheet, makeTomb } from './meshes';
import type { SignatureModule } from './registry';

export const FROZEN_TOMB = {
  raise: 0.2, // 举手
  creep: 0.35, // 蔓延
  coat: 0.3, // 每个冰棺
  stagger: 0.04, // 冰棺之间至少错开
  fade: 0.25, // 收尾
  lean: 0.28, // 后仰（弧度）
  lift: 0.1, // 抬起（底座高）
  tomb: { x: 1.16, y: 1.5, z: 1.16, rise: 0.12 }, // 冰棺相对冰层放大多少、往上多出多少
};

type Frz = EventOf<'freeze'>;

export const frozenTomb: SignatureModule = (c) => {
  const F = FROZEN_TOMB;
  const { scene } = c;
  const t = gsap.timeline();
  const frz = c.events.filter((e): e is Frz => e.kind === 'freeze');
  if (frz.length === 0) return { tl: t };
  const down = claimTurn(scene);
  const src = frz[0]!.source;
  const caster = src.kind === 'minion' ? scene.minion(src.instanceId) : undefined;
  const origin = caster ? { x: caster.position.x, z: caster.position.z } : { x: 0, z: scene.pointOf({ side: src.side, kind: 'hero' }).z };
  const dirZ = towardEnemy(scene, src.side);
  const targets = frz.map((e, k) => ({ e, k, p: scene.pointOf(e.target) }));
  const dist = (p: { x: number; z: number }) => Math.hypot(p.x - origin.x, p.z - origin.z);
  const reach = Math.max(...targets.map((x) => dist(x.p))) + 1.2;
  // 冰爬到每个目标的时刻：按到她的距离，再保证相邻两个至少错开 40ms（按到达先后）
  const order = [...targets].sort((a, b) => dist(a.p) - dist(b.p));
  let prev = -Infinity;
  const arrive = new Map<number, number>();
  for (const x of order) {
    const tt = Math.max(F.raise + F.creep * (dist(x.p) / reach), prev + F.stagger);
    arrive.set(x.k, tt);
    prev = tt;
  }
  const lastCoat = prev;
  const tEnd = Math.max(F.raise + F.creep, lastCoat + F.coat) + F.fade;

  // 举手：后仰（顶面朝自己这一侧倒）并抬起，冰爬完后落回
  at(t, 0, () => {
    sfx('spell.frost', origin.x);
    if (!caster) return;
    gsap.to(caster.body.rotation, { x: -dirZ * F.lean, duration: F.raise, ease: EASE.rise });
    gsap.to(caster.body.position, { y: F.lift * UNIT.base, duration: F.raise, ease: EASE.rise });
    flash(caster.flash, COLOR.ice, 0.35, F.raise + F.creep);
  });
  at(t, F.raise + F.creep, () => {
    if (!caster) return;
    gsap.to(caster.body.rotation, { x: 0, duration: F.fade, ease: EASE.land });
    gsap.to(caster.body.position, { y: 0, duration: F.fade, ease: EASE.land });
  });

  // 地面冰：一大块从她脚下按半径长出来，盖住她和敌方随从之间的地面
  // 只盖她和目标之间那一片（不铺满全场），亮度压低：冰是爬过去的一层，不是一块白板
  const zs = targets.map((x) => x.p.z);
  const xs = [origin.x, ...targets.map((x) => x.p.x)];
  const zFar = zs.reduce((s, z) => s + z, 0) / zs.length;
  const zMid = (origin.z + zFar) / 2;
  const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const sheet = temp(scene, t, F.raise, tEnd + 0.1, () => makeFrostSheet(Math.max(...xs) - Math.min(...xs) + 3, Math.abs(origin.z - zFar) + 2.6, COLOR.ice, 0.7), (m) => {
    m.position.set(xMid, 0.02, zMid);
    m.material.uniforms.uOrigin!.value.set(origin.x, origin.z);
    m.material.uniforms.uRadius!.value = 0;
  });
  const grow = { r: 0, o: 0.75 };
  const apply = () => {
    const m = sheet.get();
    if (!m) return;
    m.material.uniforms.uRadius!.value = grow.r;
    m.material.uniforms.uOpacity!.value = grow.o;
  };
  t.to(grow, { r: reach, duration: F.creep, ease: EASE.line, onUpdate: apply }, F.raise);
  t.to(grow, { o: 0, duration: F.fade + 0.1, ease: EASE.hide, onUpdate: apply }, tEnd - F.fade);
  // 前沿一路冒冰晶：几条朝各个目标爬的冰线
  const front = targets.map((x) => {
    const d = dist(x.p);
    const st = { k: 0 };
    t.to(st, { k: 1, duration: F.creep * (d / reach), ease: EASE.line }, F.raise);
    return () => ({ x: origin.x + (x.p.x - origin.x) * st.k, y: 0, z: origin.z + (x.p.z - origin.z) * st.k });
  });
  at(t, F.raise, () => {
    for (const f of front) scene.particles.emit(SIGNATURE_PRESETS.frost_creep, { at: f(), follow: f, count: Math.max(10, Math.round(30 / front.length)), dir: 'up' });
  });

  // 冰棺
  targets.forEach(({ e, k, p }) => {
    const tt = arrive.get(k)!;
    const first = tt === Math.min(...arrive.values());
    at(t, tt, () => {
      scene.sync(c.ctxs[k]!.after, 0.1);
      const m = minionOf(scene, e.target);
      scene.particles.emit('frost_spread', { at: { x: p.x, y: 0, z: p.z }, count: 18, dir: 'up' });
      sfx('combat.freeze', p.x);
      if (first) {
        sfx('combat.hit_heavy', p.x);
        bigShake(scene, 1, down);
        bigFlash(scene, COLOR.ice, down);
      }
      if (!m) return;
      iceRise(m, F.coat);
      encase(scene, m, F.coat);
      flash(m.flash, COLOR.ice, 0.9, F.coat);
      jitter(m.body, FREEZE.shakeAmp * UNIT.base, FREEZE.shakes, FREEZE.shakeTime * FREEZE.shakes);
    });
  });

  span(t, tEnd);
  return { tl: t, tail: tEnd - lastCoat, hitAt: Math.min(...arrive.values()) };
};

// 冰棺挂在随从的冰层下面：冰层长、它跟着长，冰层退（解冻）、它跟着退；冰层藏起来或随从没了，冰棺拿掉
function encase(scene: TableScene, m: MinionView, duration: number): void {
  const T = FROZEN_TOMB.tomb;
  const old = m.ice.getObjectByName('frozen_tomb');
  if (old) old.removeFromParent();
  const tomb = makeTomb(scene);
  tomb.name = 'frozen_tomb';
  m.ice.add(tomb);
  tomb.position.y = T.rise;
  tomb.scale.set(T.x * 0.7, T.y, T.z * 0.7);
  gsap.to(tomb.scale, { x: T.x, z: T.z, duration, ease: 'back.out(2)' });
  const stop = scene.stage.onFrame(() => {
    if (tomb.parent === m.ice && m.ice.visible && scene.minion(m.instanceId) === m) return;
    removeTomb(tomb);
    stop();
  });
}

function removeTomb(tomb: THREE.Object3D): void {
  gsap.killTweensOf(tomb.scale);
  tomb.removeFromParent();
}
