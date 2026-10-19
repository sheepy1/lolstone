// 胜负（m4-storyboard E28 胜利、E29 失败，各 3000ms）。结算面板由界面层在这一步播完时升起（t=2.6s）。
// 胜利：定格 200ms（常驻小动画停下，胜利音乐）→ 敌方枢纽灯芯猛亮后缩没、爆炸 600ms（nexus_burst 120、水晶碎片 30、
//   spark_heavy，S3 加白闪）→ 环境光加 40% 偏暖、胜利碎屑 200 从上方落 → "胜利"从上方砸到中央（800ms 砸，落地 S1，金色光晕）。
// 失败：定格 200ms（失败音乐；我方枢纽六颗灯芯猛亮 60ms 再缩没 140ms）→ 爆炸 600ms（暗红 nexus_burst 80、碎片 20，S3，
//   白闪只有 30ms）→ 压暗 600ms（饱和度 -50%、亮度 -30%、四边暗角）→ "失败"灰蓝色从中央放大淡入，不砸。沉而不吵：
//   没有碎屑，没有第二次震屏。平局按失败的节奏，两座枢纽一起爆。
// 声音：flow.victory / flow.defeat 在定格 t=0（交给音乐通道），flow.nexus_explode 在爆炸 t=0，ui.click 在面板 t=0。
import gsap from 'gsap';
import * as THREE from 'three';
import { other, type Side } from '../../engine';
import { playSfx } from '../../audio';
import { BigWord } from '../fx/flow';
import { shakeAt } from '../fx/screen';
import type { AnimModule } from './types';
import { tl } from './util';

export const ENDGAME = {
  freeze: 0.2,
  flare: 0.06, // 灯芯猛亮
  shrink: 0.14, // 灯缩没
  burst: 0.6,
  bright: 0.4, // 胜利：变亮
  dim: 0.6, // 失败：压暗
  word: 0.8,
  panelAt: 2.6,
};

export const gameOver: AnimModule<'game_over'> = (e, { scene, viewer }) => {
  const t = tl();
  const P = ENDGAME;
  const stage = scene.stage;
  const won = e.winner === viewer;
  const draw = e.winner === 'draw';
  const losers: Side[] = draw ? [0, 1] : [other(e.winner as Side)];
  const center = { x: 0, y: 3.4, z: 2.4 };
  const word = new BigWord(stage, scene.layers.top, center, draw ? '平局' : won ? '胜利' : '失败', won ? 0xffd56a : 0xa8bccf, won ? 0xffb84a : null);

  // 定格
  t.call(() => {
    scene.frozen = true;
    scene.endTurn.setMode('off', false);
    playSfx(won ? 'flow.victory' : 'flow.defeat');
    for (const side of losers) scene.heroes[side].lamps?.flare();
  });
  // 输的一方：灯芯猛亮后整颗灯缩没
  for (const side of losers) {
    const hero = scene.heroes[side];
    const lamps = hero.lamps?.roots ?? [];
    t.to(lamps.map((l) => l.scale), { x: 0.01, y: 0.01, z: 0.01, duration: P.shrink, ease: 'power3.in' }, P.flare);
  }
  // 爆炸
  t.call(
    () => {
      for (const side of losers) {
        const hero = scene.heroes[side];
        const at = { x: hero.position.x, y: 0.4, z: hero.position.z };
        playSfx('flow.nexus_explode', { pan: scene.panAt(at) });
        const crystal = side === viewer ? 0x3a8cff : 0xff3030;
        if (won) {
          scene.particles.emit('nexus_burst', { at, count: 120 });
          scene.particles.emit('death_shards', { at, count: 30, color: crystal });
          scene.particles.emit('spark_heavy', { at: { ...at, y: 0.8 } });
        } else {
          scene.particles.emit('nexus_burst', { at, count: 80, color: 0x8a1a1a });
          scene.particles.emit('death_shards', { at, count: 20, color: crystal });
        }
        // 枢纽塌掉：整座缩没
        gsap.to(hero.body.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.25, ease: 'power3.in', delay: 0.05 });
      }
    },
    undefined,
    P.freeze,
  );
  t.add(shakeAt(scene, 3, { force: true, flash: won ? 0.06 : 0.03 }), P.freeze);
  const after = P.freeze + P.burst;
  if (won) {
    // 变亮：环境光加 40%，偏暖；碎屑从上方飘落
    const { hemi, sun } = scene.lights;
    const warm = new THREE.Color(0xffe2b8);
    t.call(() => scene.particles.emit('victory_confetti', { at: { x: 0, y: 7, z: 1.5 }, count: 200 }), undefined, after);
    t.to(hemi, { intensity: hemi.intensity * 1.4, duration: P.bright, ease: 'power2.out' }, after);
    t.to(sun, { intensity: sun.intensity * 1.15, duration: P.bright, ease: 'power2.out' }, after);
    t.to(hemi.color, { r: warm.r, g: warm.g, b: warm.b, duration: P.bright, ease: 'power2.out' }, after);
    // 落字（砸）：从上方加速砸到中央，落地压扁回弹，S1，光晕一亮
    const g = word.group;
    const wAt = after + P.bright * 0.5;
    t.call(() => {
      g.visible = true;
      g.position.set(center.x, center.y + 3, center.z);
      word.halo.material.opacity = 0;
    }, undefined, wAt);
    t.to(g.position, { y: center.y, duration: P.word * 0.45, ease: 'expo.in' }, wAt);
    t.fromTo(g.scale, { x: 1.15, y: 0.8, z: 1 }, { x: 1, y: 1, z: 1, duration: P.word * 0.55, ease: 'elastic.out(1, 0.45)', immediateRender: false }, wAt + P.word * 0.45);
    t.to(word.halo.material, { opacity: 1, duration: 0.12 }, wAt + P.word * 0.45);
    t.to(word.halo.material, { opacity: 0.55, duration: 0.5, ease: 'power2.out' }, wAt + P.word * 0.45 + 0.12);
    t.add(shakeAt(scene, 1), wAt + P.word * 0.45);
  } else {
    // 压暗：饱和度 -50%、亮度 -30%、四边暗角
    t.to(stage.look, { saturation: -0.5, brightness: -0.3, vignette: 0.75, duration: P.dim, ease: 'power2.out' }, after);
    // 落字（落）：从中央放大淡入，不砸
    const g = word.group;
    const wAt = after + P.dim * 0.5;
    const st = { a: 0 };
    t.call(() => {
      g.visible = true;
      word.text.fillOpacity = 0;
      word.text.outlineOpacity = 0;
    }, undefined, wAt);
    t.fromTo(g.scale, { x: 1.3, y: 1.3, z: 1.3 }, { x: 1, y: 1, z: 1, duration: P.word, ease: 'power2.out', immediateRender: false }, wAt);
    t.to(st, {
      a: 1,
      duration: P.word,
      ease: 'power2.out',
      onUpdate: () => {
        word.text.fillOpacity = st.a;
        word.text.outlineOpacity = st.a;
      },
    }, wAt);
  }
  // 面板：界面层在这一步播完时升起
  t.call(() => playSfx('ui.click'), undefined, P.panelAt);
  return { tl: t };
};
