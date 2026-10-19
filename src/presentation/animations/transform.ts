// 变形（m4-storyboard E22，500ms，中）：冰凤凰蛋变回艾尼维亚、璐璐把随从变成松鼠是主要用例。
// 闪白 100ms：原形象白色自发光、放大 1.1 → 炸开 150ms（线）：death_shards 8 粒白色、spark_light 6 粒，原形象消失 →
// 成形 250ms（弹）：新形象的底座从 0 放大到 1，徽章直接显示新值。
// 声音：card.transform（magic 变形声）在闪白，轻落地 card.land 在成形帧。
import gsap from 'gsap';
import { playSfx } from '../../audio';
import type { AnimModule } from './types';
import { flash, pointOf, tl } from './util';

export const TRANSFORM = { white: 0.1, burst: 0.15, form: 0.25 };

export const transform: AnimModule<'transform'> = (e, { scene, after }) => {
  const t = tl();
  const P = TRANSFORM;
  const where = pointOf(scene, e.target);
  const oldId = e.target.kind === 'minion' ? e.target.instanceId : -1;
  const newId = e.newTarget.kind === 'minion' ? e.newTarget.instanceId : -1;
  // 闪白：原形象白色自发光、放大 1.1
  t.call(() => {
    playSfx('card.transform', { pan: scene.panAt(where()) });
    const old = scene.minion(oldId);
    if (!old) return;
    flash(old.flash, 0xffffff, 1, P.white + P.burst);
    gsap.to(old.body.scale, { x: 1.1, y: 1.1, z: 1.1, duration: P.white, ease: 'power2.out' });
  });
  // 炸开：白色碎片和火花，原形象缩没
  t.call(
    () => {
      const p = where();
      scene.particles.emit('death_shards', { at: { x: p.x, y: 0.3, z: p.z }, count: 8, color: 0xffffff });
      scene.particles.emit('spark_light', { at: { x: p.x, y: 0.4, z: p.z }, count: 6, color: 0xffffff });
      const old = scene.minion(oldId);
      if (old) gsap.to(old.body.scale, { x: 0.01, y: 0.01, z: 0.01, duration: P.burst, ease: 'none' });
    },
    undefined,
    P.white,
  );
  // 成形（弹）：sync 换上新随从（先不显示），底座从 0 放大到 1
  t.call(
    () => {
      scene.heldSpawns.add(newId);
      scene.sync(after, 0.2);
      const m = scene.minion(newId);
      if (!m) return;
      m.body.visible = true;
      m.body.position.y = 0;
      gsap.fromTo(m.body.scale, { x: 0.01, y: 0.01, z: 0.01 }, { x: 1, y: 1, z: 1, duration: P.form, ease: 'back.out(2)' });
      flash(m.flash, 0xffffff, 0.6, P.form);
      playSfx('card.land', { pan: scene.panAt(m.position) });
    },
    undefined,
    P.white + P.burst,
  );
  t.to({}, { duration: P.form }, P.white + P.burst);
  return { tl: t, tail: P.form };
};
