// 增益（m4-storyboard E15，400ms，轻档）：buff_ring 金环绕底座一圈 300ms，变化的徽章弹一下（数字高于卡面时变绿），
// 头像金色自发光 0.3 淡出 300ms；获得潜行、圣盾、嘲讽时各自的进入表现（E18、E19）。增益声 t=0。
// 群体增益按目标从左到右错开 40ms，用一圈大金环盖住整排代替每个一圈。
// 减益（E16）：头像亮度压到 0.5，150ms 回来；变化的徽章弹一下并变红；shadow_gather 紫色向内聚 200ms。减益声 t=0。
// 增益到期（reason expire）按数值变化的方向走增益或减益。
import { FX_PALETTE } from '../fx/particles';
import { boardSlot } from '../layout';
import { BUFF, dimPortrait, hold, portraitGlow, sfxAt, statusEnter, targetX, UNIT } from './combat';
import type { AnimModule, Cue } from './types';
import { TINT, tl } from './util';

export const buff: AnimModule<'buff'> = (e, { scene, after }) => {
  const B = BUFF;
  const t = tl();
  const x = targetX(scene, e.target);
  const positive = e.attack + e.health > 0 || (e.attack + e.health === 0 && e.keywords.length > 0);
  const m = () => (e.target.kind === 'minion' ? scene.minion(e.target.instanceId) : undefined);
  t.call(() => {
    sfxAt(positive ? 'card.buff' : 'card.debuff', x);
    scene.sync(after, 0.05);
    const v = m();
    const p = scene.pointOf(e.target);
    if (positive) {
      portraitGlow(v, TINT.buff, B.glow, B.glowFade);
    } else {
      scene.particles.emit('shadow_gather', { at: { x: p.x, y: 0, z: p.z }, count: B.gather, color: FX_PALETTE.debuff, dir: 'in' });
      dimPortrait(v, B.debuffDim, B.debuffBack, B.gatherTime - B.debuffBack);
    }
    if (v && e.target.kind === 'minion') {
      if (e.attack !== 0) v.badges.attack.pop(e.attack > 0 ? TINT.buff : TINT.debuff);
      if (e.health !== 0 || e.maxHealthAfter !== e.maxHealthBefore) v.badges.health.pop(e.health >= 0 ? TINT.buff : TINT.debuff);
      if (e.keywords.length > 0) statusEnter(scene, e.target.instanceId, e.keywords);
    }
  });
  hold(t, 0.4, 0);
  const cues: Cue[] = [];
  if (positive) {
    const ringAt = () => {
      const p = scene.pointOf(e.target);
      return { x: p.x, y: 0, z: p.z };
    };
    cues.push({
      channel: 'buff_ring',
      at: 0,
      weight: 1,
      run: () => scene.particles.emit('buff_ring', { at: ringAt(), color: FX_PALETTE.buff }),
      // 群体增益：一圈大金环盖住目标那一排
      many: () => {
        const side = e.target.side;
        const n = Math.max(1, scene.view.players[side].board.length);
        const row = boardSlot(scene.place(side), 0, 1).pos;
        scene.particles.emit('buff_ring', { at: { x: 0, y: 0, z: row.z }, color: FX_PALETTE.buff, scale: Math.max(1, (n * UNIT.slot) / (UNIT.base * 1.6)) });
      },
    });
  }
  return { tl: t, cues, order: x, stagger: B.stagger };
};
