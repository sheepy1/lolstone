// 随从死亡（m4-storyboard E14，700ms，中档）：
// 定格 80ms：头像去饱和、亮度 0.6，两个徽章消失；
// 碎裂 350ms（线）：底座连同头像碎成 9 块，带重力散开、落到台面、淡出；碎裂帧 spark_light 和 death_shards 碎屑；
// 合拢 270ms（落）：从碎裂的 250ms 处开始，相邻随从滑到新槽位。
// 声音：碎裂声在碎裂帧；死亡台词再晚 120ms。同组多个死亡错开 50ms，碎裂声和台词都只放一条，台词放最后死的那个。
// 亡语：下一组（亡语的 trigger）在相邻随从开始合拢时就开始，不等这一步播完。
import { playVoice } from '../../audio';
import { championOf } from '../../assets/manifest';
import { getCard } from '../../engine';
import { greyOut, shatterMinion } from '../fx/shatter';
import { DEATH, hold, sfxAt, targetX } from './combat';
import type { AnimModule, Cue } from './types';
import { syncTo, tl } from './util';

export const death: AnimModule<'death'> = (e, { scene, before, after }) => {
  const D = DEATH;
  const t = tl();
  const m = e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined;
  const x = targetX(scene, e.target);
  const shatterAt = D.freeze;
  // 定格
  t.call(() => {
    if (!m) return;
    m.setHighlight('none');
    greyOut(m, D.greyBrightness);
    m.badges.attack.visible = false;
    m.badges.health.visible = false;
  });
  // 碎裂
  t.call(
    () => {
      if (!m) return;
      const p = scene.pointOf(e.target);
      m.body.visible = false;
      shatterMinion(scene.layers.fx, m, {
        pieces: D.pieces,
        speed: D.pieceSpeed,
        up: D.pieceUp,
        gravity: D.gravity,
        spin: D.spin,
        duration: D.shatter,
        fade: D.fade,
        brightness: D.greyBrightness,
      });
      scene.particles.emit('spark_light', { at: { x: p.x, y: 0.35, z: p.z }, count: D.sparks });
      scene.particles.emit('death_shards', { at: { x: p.x, y: 0.2, z: p.z }, count: 8, color: 0x8a8f99 });
    },
    undefined,
    shatterAt,
  );
  // 合拢
  t.add(syncTo(scene, after, D.close), shatterAt + D.closeAt);
  hold(t, D.freeze + D.shatter + D.close, 0);
  const cues: Cue[] = [{ channel: 'impact:death', at: shatterAt, weight: 1, run: () => sfxAt('combat.death', x) }];
  const champ = championOf(e.cardId);
  if (champ) cues.push({ channel: 'voice', at: shatterAt + D.voiceDelay, weight: 1, run: () => playVoice(champ, 'ban') });
  // 收尾：相邻随从合拢这一段（分镜 1.7 组间重叠）。带亡语（且没被沉默）时，亡语的 trigger 在下一组，
  // 分镜 E14 要它在合拢开始时就起：用 readyAt 直接指定
  const closeAt = shatterAt + D.closeAt;
  const target = e.target;
  const vm = target.kind === 'minion' ? before.players[target.side].board.find((b) => b.instanceId === target.instanceId) : undefined;
  const rattle = !vm?.silenced && (getCard(e.cardId).effects ?? []).some((eff) => eff.trigger === 'deathrattle');
  return { tl: t, cues, order: x, stagger: D.stagger, tail: D.freeze + D.shatter + D.close - closeAt, readyAt: rattle ? closeAt : undefined };
};
