// 开局（m4-storyboard E01，约 2.5 秒，可快进）加发起手牌（m4-first-minutes 第 4 步）：
// 远景 300ms → 镜头推到对局机位 1100ms（落）→ 双方枢纽先后点亮（先对手后我方，错开 150ms，小灯逐颗 40ms 亮起，底座扬尘）
// → 中央徽记翻转停在"先手 / 后手"500ms（飘）→ 徽记淡出 300ms → 起手牌从牌库逐张飞出，飞行中翻到正面（错开 120ms）。
// 先后手在 createGame 时就定了（事件的 first），所以先后手的演出放在换牌之前，game_start 只负责把手牌收进扇形。
// 声音：flow.game_start 在 t=0（对局音乐由对局层在开局时起）；flow.nexus_light 在每座枢纽的点亮帧；翻转和发牌用 card.draw。
import { other } from '../../engine';
import { playSfx } from '../../audio';
import { CAMERA, deckSlot, above } from '../layout';
import { Emblem, flyFromDeck } from '../fx/flow';
import type { AnimModule } from './types';
import { tl } from './util';

export const OPENING = {
  wide: 0.3, // 远景停留
  push: 1.1, // 推进
  far: { x: 0, y: 27, z: 4 }, // 远景镜头位置：高处几乎垂直俯视整张棋盘
  farTarget: { x: 0, y: 0, z: 0.3 },
  lightAt: 1.3, // 对手枢纽开始点亮（推进快结束时）
  lightGap: 0.15, // 两座枢纽错开
  light: 0.25, // 每颗灯从 0 到 1
  lampStagger: 0.04, // 灯与灯错开
  coinAt: 1.75, // 先后手徽记
  coin: 0.5,
  coinOut: 0.3,
  dealGap: 0.12, // 起手牌逐张错开
};

export const mulliganStart: AnimModule<'mulligan_start'> = (e, { scene, after, viewer }) => {
  const t = tl();
  const P = OPENING;
  const stage = scene.stage;
  const emblem = new Emblem(stage, scene.layers.top, { x: 0, y: 3.2, z: 2.2 }, e.first === viewer ? '先手' : '后手', stage.reflections);
  // 镜头和灯在这里就设好（不等时间线第一帧），开局不会先闪一帧对局机位
  scene.intro = true;
  scene.sync(scene.view, 0); // 收起换牌的压暗板
  stage.cameraBase.set(P.far.x, P.far.y, P.far.z);
  stage.cameraTarget.set(P.farTarget.x, P.farTarget.y, P.farTarget.z);
  for (const h of scene.heroes) h.lamps?.setPower(0);
  t.call(() => playSfx('flow.game_start'));
  // 推进（落）
  t.to(stage.cameraBase, { ...CAMERA.pos, duration: P.push, ease: 'power2.out' }, P.wide);
  t.to(stage.cameraTarget, { ...CAMERA.target, duration: P.push, ease: 'power2.out' }, P.wide);
  // 枢纽点亮：先对手后我方
  [other(viewer), viewer].forEach((side, k) => {
    const at = P.lightAt + k * P.lightGap;
    const hero = scene.heroes[side];
    t.call(
      () => {
        playSfx('flow.nexus_light', { pan: scene.panAt(hero.position) });
        scene.particles.emit('dust_land', { at: { x: hero.position.x, y: 0, z: hero.position.z }, count: 6 });
      },
      undefined,
      at,
    );
    if (hero.lamps) t.add(hero.lamps.lightUp(P.light, P.lampStagger), at);
  });
  // 先后手（飘）
  t.call(() => playSfx('card.draw'), undefined, P.coinAt);
  t.add(emblem.flip(P.coin), P.coinAt);
  t.add(emblem.out(P.coinOut), P.coinAt + P.coin + 0.15);
  // 发起手牌：sync 先把牌放到换牌位置，再一张张从牌库飞过去；我方的翻到正面
  const dealAt = P.coinAt + P.coin + 0.15 + P.coinOut * 0.5;
  const mine = after.players[viewer].hand.length;
  const theirs = after.players[other(viewer)].hand.length;
  t.call(
    () => {
      scene.intro = false;
      scene.sync(after, 0);
      for (const side of [viewer, other(viewer)]) {
        const deck = above(deckSlot(scene.place(side)).pos, 0.3);
        after.players[side].hand.forEach((c, i) => {
          const card = scene.handCards.get(c.instanceId);
          if (!card) return;
          const fly = flyFromDeck(card, deck, { flip: side === viewer, onFlip: side === viewer ? () => playSfx('card.draw', { pan: scene.panAt(card.position) }) : undefined });
          fly.delay(i * P.dealGap + (side === viewer ? 0 : 0.06));
        });
      }
    },
    undefined,
    dealAt,
  );
  t.to({}, { duration: Math.max(mine, theirs) * P.dealGap + 0.55 }, dealAt);
  return { tl: t };
};
