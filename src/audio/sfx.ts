// 音效表（spec 5.7）。每个音效一个文件，是用户在试听页从 2 到 3 个候选里选定的（scripts/data/audio-sources.json 的 selected），
// 文件在 public/audio/sfx/<id>.ogg|mp3，由 scripts/normalize-audio.ts 统一响度后生成。重复感靠音高随机浮动正负 5%，
// 同一音效同时最多 4 个实例。
import { Howl } from 'howler';
import type { Fx } from '../engine';
import { channelVolume } from './channels';
import { sfxSrc } from './files';
import { playMusic, type TrackId } from './music';

export type SfxId =
  // 界面
  | 'ui.hover'
  | 'ui.click'
  | 'ui.button'
  | 'ui.pickup'
  | 'ui.drop'
  | 'ui.cancel'
  // 卡牌
  | 'card.draw'
  | 'card.play'
  | 'card.land'
  | 'card.land_heavy'
  | `spell.${Fx}`
  | 'spell.big'
  | 'card.buff'
  | 'card.debuff'
  | 'card.silence'
  | 'card.bounce'
  | 'card.transform'
  | 'card.burn'
  // 战斗
  | 'combat.swing'
  | 'combat.hit_light'
  | 'combat.hit_heavy'
  | 'combat.hit_low'
  | 'combat.hero_hit'
  | 'combat.death'
  | 'combat.shield_break'
  | 'combat.freeze'
  | 'combat.unfreeze'
  | 'combat.stealth'
  | 'combat.heal'
  | 'combat.summon'
  // 职业
  | 'hero_power.demacia'
  | 'hero_power.noxus'
  | 'hero_power.ionia'
  | 'hero_power.freljord'
  // 流程
  | 'flow.game_start'
  | 'flow.nexus_light'
  | 'flow.nexus_explode'
  | 'flow.turn_start'
  | 'flow.turn_end'
  | 'flow.fatigue'
  | 'flow.victory'
  | 'flow.defeat'
  | 'flow.mana';

/**
 * volume：这个音效相对其他音效的轻重。素材都已经统一过响度，这里只表达"悬停比按钮轻"这类有意的差别。
 * music：这个键实际是一段音乐，交给音乐通道播（胜负收尾，播时停掉对局音乐）。
 */
type SfxDef = { volume: number; music?: TrackId };

const MAX_INSTANCES = 4;
const PITCH_JITTER = 0.05;

const sfx = (volume = 1): SfxDef => ({ volume });

// 键覆盖 spec 5.7 的全部分类和 5.6 声音列里的开场音、枢纽点亮、群体法术、枢纽爆炸。
export const SFX_TABLE: Record<SfxId, SfxDef> = {
  'ui.hover': sfx(0.4),
  'ui.click': sfx(),
  'ui.button': sfx(),
  'ui.pickup': sfx(),
  'ui.drop': sfx(),
  'ui.cancel': sfx(),
  'card.draw': sfx(),
  'card.play': sfx(),
  'card.land': sfx(), // 轻落地：费用 ≤ 3 的随从、衍生物、变形
  'card.land_heavy': sfx(), // 重落地：费用 ≥ 4（m4-storyboard E07）
  'spell.physical': sfx(),
  'spell.fire': sfx(),
  'spell.frost': sfx(),
  'spell.holy': sfx(),
  'spell.shadow': sfx(),
  'spell.big': sfx(),
  'card.buff': sfx(),
  'card.debuff': sfx(),
  'card.silence': sfx(), // 沉默的消音声（E16）
  'card.bounce': sfx(),
  'card.transform': sfx(),
  'card.burn': sfx(),
  'combat.swing': sfx(),
  'combat.hit_light': sfx(),
  'combat.hit_heavy': sfx(),
  'combat.hit_low': sfx(), // 伤害 ≥ 5 时叠在命中声下面的低频层（1.6、E12、E24）
  'combat.hero_hit': sfx(),
  'combat.death': sfx(),
  'combat.shield_break': sfx(),
  'combat.freeze': sfx(),
  'combat.unfreeze': sfx(),
  'combat.stealth': sfx(),
  'combat.heal': sfx(),
  'combat.summon': sfx(),
  'hero_power.demacia': sfx(),
  'hero_power.noxus': sfx(),
  'hero_power.ionia': sfx(),
  'hero_power.freljord': sfx(),
  'flow.game_start': sfx(),
  'flow.nexus_light': sfx(),
  'flow.nexus_explode': sfx(),
  'flow.turn_start': sfx(),
  'flow.turn_end': sfx(),
  'flow.fatigue': sfx(),
  'flow.victory': { volume: 1, music: 'victory' },
  'flow.defeat': { volume: 1, music: 'defeat' },
  'flow.mana': sfx(0.5),
};

export const SFX_IDS = Object.keys(SFX_TABLE) as SfxId[];

/** 有自己文件的音效（转给音乐通道的不算）。 */
export function sfxFiles(id: SfxId): string[] | null {
  return SFX_TABLE[id].music ? null : sfxSrc(id);
}

const howls = new Map<SfxId, Howl>();
const playing = new Map<SfxId, number>();

function howlFor(id: SfxId, src: string[]): Howl {
  let h = howls.get(id);
  if (!h) {
    h = new Howl({ src, preload: true });
    howls.set(id, h);
  }
  return h;
}

// 预载全部音效，第一次播放时不用现等下载（加起来不到 1 MB）。音频初始化时调。
export function preloadSfx(): void {
  for (const id of SFX_IDS) {
    const src = sfxFiles(id);
    if (src) howlFor(id, src);
  }
}

// 最近播过的音效，调试和测试用：从这里能看到每个事件都发出了音效请求。
export const sfxLog: SfxId[] = [];

/** pan：左右声像，-1 最左、0 居中、1 最右（spec 5.7 按棋盘位置做声像，表现层按物件在屏幕上的横坐标换算）。 */
export type SfxOptions = { pan?: number };

export function playSfx(id: SfxId, opts: SfxOptions = {}): void {
  sfxLog.push(id);
  if (sfxLog.length > 200) sfxLog.shift();
  const def = SFX_TABLE[id];
  if (def.music) {
    playMusic(def.music);
    return;
  }
  const count = playing.get(id) ?? 0;
  if (count >= MAX_INSTANCES) return;
  const h = howlFor(id, sfxSrc(id));
  const sound = h.play();
  h.volume(def.volume * channelVolume('sfx'), sound);
  h.rate(1 + (Math.random() * 2 - 1) * PITCH_JITTER, sound);
  if (opts.pan) h.stereo(Math.max(-1, Math.min(1, opts.pan)), sound);
  playing.set(id, count + 1);
  const done = () => playing.set(id, Math.max(0, (playing.get(id) ?? 1) - 1));
  h.once('end', done, sound);
  h.once('stop', done, sound);
}
