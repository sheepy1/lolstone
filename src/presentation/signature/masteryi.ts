// masteryi.highlander 易 · 600ms · 中（m4-signature-fx）。on_kill 触发（trigger，timing on_kill），在击杀的死亡那一步之后：
// 残影 0–150（线）：slash_burst（slash_trail 的迸发变体）24 道刀光从易身上散开，三个头像残影向外滑开淡掉，头像蓝白自发光闪一下；
// 重置 150–400（弹）：底座外一圈绿色描边重新亮起、从大收回并弹一下，buff_ring 小号蓝色；能攻击的绿边点亮（我方的易）；
// 收尾 400–600（飘）。没有震屏。重点是把"又能动了"显示出来，玩家下一步就会去点他。
import gsap from 'gsap';
import * as THREE from 'three';
import { COLORS } from '../../scene/theme';
import { portraitGlow, portraitMesh } from '../animations/combat';
import { SIGNATURE_PRESETS } from '../fx/particles/presets';
import { MINION_HEIGHT, MINION_SIZE } from '../layout';
import { at, EASE, sfx, span } from './kit';
import { makeGroundRing, planeGeometry } from './meshes';
import type { SignatureModule } from './registry';

export const HIGHLANDER = {
  burst: 0.15, // 残影
  reset: 0.25, // 重置
  fade: 0.2, // 收尾
  ghosts: 3,
  ghostSlide: 0.55, // 残影滑出多远
};

const BLUE = 0xbfe6ff;

export const highlander: SignatureModule = (c) => {
  const H = HIGHLANDER;
  const { scene, viewer } = c;
  const t = gsap.timeline();
  const e = c.events[0]!;
  if (e.kind !== 'trigger' || e.source.kind !== 'minion') return { tl: t };
  const id = e.source.instanceId;
  const side = e.source.side;
  const tReset = H.burst;
  const tEnd = tReset + H.reset + H.fade;

  at(t, 0, () => {
    const m = scene.minion(id);
    if (!m) return;
    const p = scene.pointOf({ side, kind: 'minion', instanceId: id });
    sfx('combat.swing', p.x);
    sfx('hero_power.ionia', p.x);
    scene.particles.emit(SIGNATURE_PRESETS.slash_burst, { at: { x: p.x, y: 0, z: p.z }, color: BLUE });
    portraitGlow(m, BLUE, 1.3, H.burst + H.reset);
    // 头像残影：同一张头像贴图的加色平面，向三个方向滑开、淡掉
    const tex = portraitMesh(m)?.material.map ?? null;
    for (let i = 0; i < H.ghosts; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(BLUE).multiplyScalar(0.9), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const g = new THREE.Mesh(planeGeometry(), mat);
      g.rotation.x = -Math.PI / 2;
      g.scale.set(MINION_SIZE - 0.2, MINION_SIZE - 0.2, 1);
      g.position.set(p.x, MINION_HEIGHT + 0.03 + i * 0.01, p.z);
      scene.layers.fx.add(g);
      const a = -Math.PI / 2 + (i - 1) * 1.1 + Math.PI;
      gsap.to(g.position, { x: p.x + Math.cos(a) * H.ghostSlide, z: p.z + Math.sin(a) * H.ghostSlide * 0.6, y: MINION_HEIGHT + 0.25, duration: H.burst + 0.15, ease: EASE.land });
      gsap.to(mat, {
        opacity: 0,
        duration: H.burst + 0.15,
        ease: EASE.hide,
        onComplete: () => {
          g.removeFromParent();
          mat.dispose();
        },
      });
    }
  });
  // 重置：绿边从大收回来并弹一下，蓝色小环
  at(t, tReset, () => {
    const m = scene.minion(id);
    if (!m) return;
    const p = scene.pointOf({ side, kind: 'minion', instanceId: id });
    scene.particles.emit('buff_ring', { at: { x: p.x, y: 0, z: p.z }, color: 0x6fd0ff, scale: 0.75, count: 16 });
    if (side === viewer) m.setHighlight('attack');
    gsap.fromTo(m.body.scale, { x: 1.12, y: 1.12, z: 1.12 }, { x: 1, y: 1, z: 1, duration: H.reset, ease: EASE.bounce });
    const ring = makeGroundRing(COLORS.playable, 2.8);
    ring.position.set(p.x, 0.035, p.z);
    ring.scale.setScalar(1.7);
    scene.layers.fx.add(ring);
    gsap.to(ring.scale, { x: 0.95, y: 0.95, z: 0.95, duration: H.reset, ease: EASE.bounce });
    gsap.to(ring.material, {
      opacity: 0,
      duration: H.fade,
      delay: H.reset,
      ease: EASE.hide,
      onComplete: () => {
        ring.removeFromParent();
        ring.material.dispose();
      },
    });
  });
  span(t, tEnd);
  return { tl: t, tail: H.fade + H.reset * 0.5 };
};
