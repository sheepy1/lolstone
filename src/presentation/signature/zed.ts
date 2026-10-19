// zed.living_shadow 劫 · 800ms · 中（m4-signature-fx）。战吼召唤（minion_summoned，via effect），劫落地（E07）之后：
// 分离 0–250（线）：shadow_gather 反向（dir out）30 从劫身上散出，劫本体闪黑 100ms，一道黑影贴着地面从劫滑到右边的空槽；
// 成形 250–600（弹）：影分身在槽位成形（E20 的凝聚，暗影色），底座和头像压暗、外面一层暗紫色的影子；
// 收尾 600–800（飘）。影分身的头像本来就是劫的影子（LoR 的影分身原画），这里只把它压暗、透出影子的紫色，
// 一看就是"劫的影子"而不是另一个随从。潜行的进入表现照常（statusEnter）。
import gsap from 'gsap';
import * as THREE from 'three';
import type { EventOf } from '../../engine';
import { MINION_TOP } from '../../scene/geometry';
import type { MinionView } from '../../scene/minionView';
import { dimPortrait, statusEnter } from '../animations/combat';
import { flash } from '../animations/util';
import { MINION_HEIGHT } from '../layout';
import { at, COLOR, EASE, sfx, span, temp } from './kit';
import { makeShadowPatch } from './meshes';
import type { SignatureModule } from './registry';

export const LIVING_SHADOW = {
  split: 0.25, // 分离
  form: 0.35, // 成形
  fade: 0.2, // 收尾
  blink: 0.1, // 劫闪黑
  gather: 30,
  veil: 0.42, // 影分身头像上那层暗影的不透明度
};

type Summon = EventOf<'minion_summoned'>;

export const livingShadow: SignatureModule = (c) => {
  const Z = LIVING_SHADOW;
  const { scene } = c;
  const t = gsap.timeline();
  const e = c.events.find((x): x is Summon => x.kind === 'minion_summoned');
  if (!e || e.target.kind !== 'minion') return { tl: t };
  const id = e.target.instanceId;
  const after = c.ctxs[c.events.indexOf(e)]!.after;
  const zedId = e.source?.kind === 'minion' ? e.source.instanceId : null;
  const tForm = Z.split;
  const tEnd = tForm + Z.form + Z.fade;
  const from = { x: 0, z: 0 };
  const to = { x: 0, z: 0 };

  // 分离：影分身先藏着，邻居让出空槽；劫闪黑、黑影滑出
  at(t, 0, () => {
    scene.heldSpawns.add(id);
    scene.sync(after, Z.split);
    const zed = zedId !== null ? scene.minion(zedId) : undefined;
    const shadow = scene.minion(id);
    if (zed) {
      from.x = zed.position.x;
      from.z = zed.position.z;
      dimPortrait(zed, 0.12, Z.blink * 1.5, Z.blink * 0.5);
      flash(zed.flash, COLOR.shadow, 0.7, Z.blink * 2);
      scene.particles.emit('shadow_gather', { at: { x: from.x, y: 0, z: from.z }, dir: 'out', count: Z.gather, color: COLOR.shadow });
    }
    if (shadow) {
      // 槽位是布局滑动的终点（外层 Group 正在滑过去，取目标位置）
      const slot = scene.view.players[e.side].board.findIndex((m) => m.instanceId === id);
      to.x = shadow.position.x;
      to.z = shadow.position.z;
      if (slot >= 0) {
        const p = scene.pointOf(e.target);
        to.x = p.x;
        to.z = p.z;
      }
    } else Object.assign(to, from);
    sfx('spell.shadow', from.x);
  });
  const patch = temp(scene, t, 0, tForm + Z.form, () => makeShadowPatch(1.7), (m) => m.position.set(from.x, 0.025, from.z));
  const slide = { k: 0, o: 0 };
  const apply = () => {
    const m = patch.get();
    if (!m) return;
    m.position.x = from.x + (to.x - from.x) * slide.k;
    m.position.z = from.z + (to.z - from.z) * slide.k;
    m.material.opacity = slide.o;
    m.scale.set(1.7 * (1 + 0.35 * Math.sin(Math.PI * slide.k)), 1.7 * (1 - 0.2 * Math.sin(Math.PI * slide.k)), 1);
  };
  t.to(slide, { k: 1, duration: Z.split, ease: EASE.line, onUpdate: apply }, 0);
  t.to(slide, { o: 0.85, duration: 0.08, ease: EASE.show, onUpdate: apply }, 0);
  t.to(slide, { o: 0, duration: Z.form, ease: EASE.hide, onUpdate: apply }, tForm);
  at(t, 0.02, () => {
    const follow = () => {
      const m = patch.get();
      return m ? { x: m.position.x, y: 0, z: m.position.z } : { x: to.x, y: 0, z: to.z };
    };
    scene.particles.emit('stealth_smoke', { at: follow(), follow, count: 10, color: 0x2a1e3a });
    // 黑影在暗色的台面上看不清，跟一道暗紫色的加色拖尾把"滑过去"的路线画出来
    scene.particles.emit('fire_bolt', { at: { x: from.x, y: 0.3, z: from.z }, to: { x: to.x, y: 0.3, z: to.z }, color: 0x8a4dff, count: 24, scale: 0.6, duration: Z.split });
  });

  // 成形：暗影向内凝聚，影分身从小弹到原大
  at(t, tForm, () => {
    scene.particles.emit('shadow_gather', { at: { x: to.x, y: 0, z: to.z }, dir: 'in', count: 20, color: COLOR.shadow });
    scene.heldSpawns.delete(id);
    const m = scene.minion(id);
    if (!m) return;
    m.body.visible = true;
    gsap.fromTo(m.body.scale, { x: 0.55, y: 0.3, z: 0.55 }, { x: 1, y: 1, z: 1, duration: Z.form, ease: EASE.bounce });
    flash(m.flash, 0x8a4dff, 1, Z.form);
    shadowLook(m);
    const kw = after.players[e.side].board.find((x) => x.instanceId === id)?.keywords ?? [];
    statusEnter(scene, id, kw);
    sfx('combat.summon', to.x);
  });
  span(t, tEnd);
  return { tl: t, tail: Z.fade + Z.form * 0.4 };
};

// 影分身的常驻样子：头像上盖一层半透明的暗紫（跟着随从一起销毁）
function shadowLook(m: MinionView): void {
  if (m.body.getObjectByName('shadow_veil')) return;
  const veil = new THREE.Mesh(MINION_TOP, new THREE.MeshBasicMaterial({ color: 0x1a0d2e, transparent: true, opacity: LIVING_SHADOW.veil, depthWrite: false }));
  veil.name = 'shadow_veil';
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = MINION_HEIGHT + 0.007;
  veil.renderOrder = 1;
  m.body.add(veil);
}
