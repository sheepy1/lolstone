// AI 思考（m4-storyboard E27，时长由对局层的 AI_PACE 决定）：对手手牌里一张抬起 0.3 卡高、往后仰 8°（250ms 落），
// 停到时长结束前 200ms，放下（200ms 落）。时长超过 1 秒时三成概率先抬另一张、放下，再抬第二张；时长不足 0.6 秒时只抬不停。
// 衔接：事件里带了下一步要打出的那张牌（card）时，最后抬起的就是它，而且不放下，接着的出牌（E06）从抬起的状态直接飞出。
// 不发声。它的作用是节奏：对面像一个在想事的人。对手手里没牌时只是停顿。
import gsap from 'gsap';
import type { CardView } from '../../scene/cardView';
import { CARD_H } from '../layout';
import type { AnimModule } from './types';
import { tl } from './util';

export const AI_THINK = { lift: 0.3, tilt: 8, up: 0.25, down: 0.2, short: 0.6, long: 1, second: 0.3 };

// 抬在 body 上做：布局（手牌重排）管外层，互不干扰
function lift(card: CardView, at: number, up: number, holdUntil: number, down: number | null): void {
  const P = AI_THINK;
  const b = card.body;
  gsap.killTweensOf([b.position, b.rotation]);
  const t = gsap.timeline({ delay: at });
  t.to(b.position, { y: P.lift * CARD_H, z: P.lift * CARD_H * 0.3, duration: up, ease: 'power2.out' });
  t.to(b.rotation, { x: (-P.tilt * Math.PI) / 180, duration: up, ease: 'power2.out' }, 0);
  if (down === null) return; // 要打出的那张：不放下
  t.to(b.position, { y: 0, z: 0, duration: down, ease: 'power2.out' }, Math.max(up, holdUntil - at));
  t.to(b.rotation, { x: 0, duration: down, ease: 'power2.out' }, Math.max(up, holdUntil - at));
}

export const aiThinking: AnimModule<'ai_thinking'> = (e, { scene }) => {
  const t = tl();
  const P = AI_THINK;
  const T = e.seconds;
  t.call(() => {
    const cards = [...scene.handCards.values()].filter((c) => c.parent === scene.layers.handFar);
    if (cards.length === 0) return;
    const playing = e.card !== undefined ? cards.find((c) => c.instanceId === e.card) : undefined;
    const others = cards.filter((c) => c !== playing);
    const pick = (pool: CardView[]) => pool[Math.floor(Math.random() * pool.length)];
    if (T < P.short) {
      // 时长不够：只抬不停（抬起和放下按比例压短）
      const up = Math.min(P.up, T * 0.5);
      lift(playing ?? pick(cards), 0, up, up, playing ? null : Math.min(P.down, T - up));
      return;
    }
    if (T > P.long && others.length > 0 && Math.random() < P.second) {
      // 两张：前一半抬一张别的牌再放下，后一半抬第二张（要打出的那张，或者另一张随机的）
      const first = pick(others);
      const half = T / 2;
      lift(first, 0, P.up, half - P.down, P.down);
      const rest = others.filter((c) => c !== first);
      const second = playing ?? (rest.length > 0 ? pick(rest) : first);
      lift(second, half, P.up, T - P.down, playing ? null : P.down);
      return;
    }
    lift(playing ?? pick(cards), 0, P.up, T - P.down, playing ? null : P.down);
  });
  t.to({}, { duration: T });
  return { tl: t };
};
