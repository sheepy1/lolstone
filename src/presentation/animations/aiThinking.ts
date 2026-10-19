// AI 思考（m4-storyboard E27，500 到 1500ms，时长由对局层随机）：对手手牌里随机一张抬起 0.3 卡高、往后仰 8°（250ms 落），
// 停 200 到 800ms，放下（200ms 落）；时间够的话三成概率再抬第二张。不发声。
// 它的作用是节奏：对面像一个在想事的人。对手手里没牌时只是停顿。
import gsap from 'gsap';
import { CARD_H } from '../layout';
import type { AnimModule } from './types';
import { tl } from './util';

export const AI_THINK = { lift: 0.3, tilt: 8, up: 0.25, down: 0.2, holdMin: 0.2, holdMax: 0.8, second: 0.3 };

export const aiThinking: AnimModule<'ai_thinking'> = (e, { scene }) => {
  const t = tl();
  const P = AI_THINK;
  const total = e.seconds;
  t.call(() => {
    const cards = [...scene.handCards.values()].filter((c) => c.parent === scene.layers.handFar);
    if (cards.length === 0) return;
    const used = new Set<number>();
    let at = 0.05;
    for (let n = 0; n < 2; n++) {
      if (n === 1 && Math.random() > P.second) break;
      const hold = P.holdMin + Math.random() * (P.holdMax - P.holdMin);
      if (at + P.up + hold + P.down > total) break;
      const pool = cards.filter((c) => !used.has(c.instanceId));
      if (pool.length === 0) break;
      const card = pool[Math.floor(Math.random() * pool.length)];
      used.add(card.instanceId);
      // 抬在 body 上做：布局（手牌重排）管外层，互不干扰
      const b = card.body;
      const lift = gsap.timeline({ delay: at });
      lift.to(b.position, { y: P.lift * CARD_H, z: P.lift * CARD_H * 0.3, duration: P.up, ease: 'power2.out' });
      lift.to(b.rotation, { x: (-P.tilt * Math.PI) / 180, duration: P.up, ease: 'power2.out' }, 0);
      lift.to(b.position, { y: 0, z: 0, duration: P.down, ease: 'power2.out' }, P.up + hold);
      lift.to(b.rotation, { x: 0, duration: P.down, ease: 'power2.out' }, P.up + hold);
      at += P.up + hold + P.down + 0.05;
    }
  });
  t.to({}, { duration: total });
  return { tl: t };
};
