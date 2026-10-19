// 随从入场（spec 5.6 v0.6.2、m4-storyboard E07）：
// 从手牌打出的：牌悬在落点上方，蓄力再抬一点，然后变成随从底座快速砸到台面；落地时底座压扁再回弹，脚下扬起尘土，
// 相邻随从同时让位；高费随从加一圈冲击波和很轻的镜头震动。英雄随从落地后说登场台词。
// 效果和英雄技能召唤的衍生物从光点凝聚成形。
import gsap from 'gsap';
import { playSfx, playVoice } from '../../audio';
import { championOf } from '../../assets/manifest';
import { getCard } from '../../engine';
import { dispose } from '../../scene/dispose';
import { burst, ring } from '../fx/effects';
import { boardSlot } from '../layout';
import type { AnimModule } from './types';
import { flash, pointOf, syncTo, tl } from './util';

// E07 的参数，调试台 /dev/fx 里可以现场调
export const PLAY_MINION = {
  hover: 1.3, // 牌悬在落点上方的高度
  charge: 0.1, // 蓄力时长（秒）
  chargeLift: 0.15, // 蓄力时再抬多高
  smash: 0.11, // 砸落时长
  squashY: 0.85, // 落地压扁：高度缩到
  squashX: 1.08, // 落地压扁：宽度放到
  settle: 0.27, // 压扁回弹时长
  shockwaveCost: 5, // 这个费用及以上落地加冲击波
  shakeCost: 6, // 这个费用及以上落地加镜头轻震（S1）
  shake: 0.04, // 镜头轻震幅度
};

const dustCount = (cost: number) => (cost <= 3 ? 8 : cost <= 6 ? 14 : 20);

export const minionSummoned: AnimModule<'minion_summoned'> = (e, { scene, before, after }) => {
  const t = tl();
  const where = pointOf(scene, e.target);
  if (e.via !== 'play' || e.target.kind !== 'minion') {
    // 衍生物：光点凝聚成形
    t.add(syncTo(scene, after, 0.35));
    t.call(() => playSfx('combat.summon'), undefined, 0);
    t.add(ring(scene.layers.fx, where, 0xfff1a0, 90, 0.45), 0);
    t.call(() => {
      const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
      if (m) flash(m.flash, 0xffffff, 0.9, 0.35);
    }, undefined, 0.05);
    return { tl: t };
  }
  const id = e.target.instanceId;
  const P = PLAY_MINION;
  const cost = getCard(e.cardId).cost;
  const p = scene.place(e.side);
  const slot = boardSlot(p, e.position, before.players[e.side].board.length + 1).pos;
  const hoverY = P.hover;
  // 蓄力：悬着的牌再抬一点
  t.call(() => {
    const card = scene.pendingPlayCards.get(id);
    if (card) gsap.to(card.position, { y: hoverY + P.chargeLift, duration: P.charge, ease: 'sine.inOut' });
  });
  t.to({}, { duration: P.charge });
  // 砸落：牌变成底座，相邻随从同时让位
  t.call(() => {
    const card = scene.pendingPlayCards.get(id);
    scene.pendingPlayCards.delete(id);
    if (card) dispose(card);
    scene.heldSpawns.add(id);
    scene.boardGap = null; // 拖牌时留的空位到这里由新随从填上
    scene.sync(after, 0.25);
    const m = scene.minion(id);
    if (!m) return;
    m.body.visible = true;
    m.body.position.y = hoverY + P.chargeLift;
    m.body.scale.set(0.95, 0.95, 0.95);
    gsap.to(m.body.position, { y: 0, duration: P.smash, ease: 'expo.in' });
    gsap.to(m.body.scale, { x: 1, y: 1, z: 1, duration: P.smash, ease: 'power1.in' });
  });
  t.to({}, { duration: P.smash });
  // 落地：压扁回弹、扬尘、落地声、高费冲击波和镜头轻震，然后登场台词
  t.call(() => {
    playSfx('card.land');
    const m = scene.minion(id);
    if (!m) return;
    gsap.fromTo(
      m.body.scale,
      { x: P.squashX, y: P.squashY, z: P.squashX },
      { x: 1, y: 1, z: 1, duration: P.settle, ease: 'elastic.out(1, 0.45)', immediateRender: true },
    );
  });
  t.add(burst(scene.layers.fx, () => ({ x: slot.x, y: 0.05, z: slot.z }), 0x9a8060, dustCount(cost), 0.5), '<');
  if (cost >= P.shockwaveCost) t.add(ring(scene.layers.fx, () => ({ x: slot.x, y: 0.02, z: slot.z }), 0xd8c08a, 170, 0.45), '<');
  if (cost >= P.shakeCost) t.add(scene.shake(P.shake), '<');
  t.call(() => {
    const champ = championOf(e.cardId);
    if (champ) playVoice(champ, 'choose');
  }, undefined, '+=0.15');
  t.to({}, { duration: Math.max(0, P.settle - 0.15) });
  return { tl: t };
};
