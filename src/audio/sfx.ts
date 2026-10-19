// 音效表（spec 5.7）。每类准备 2 到 3 个变体随机选，音高随机浮动正负 5%，同一音效同时最多 4 个实例。
// M3 只有框架：表里的变体列表都是空的，play 什么也不播。M4 把 CC0 素材放进 public/audio/sfx/ 并填表，
// 或者合成一张音效表（sprite）后把 src 换成 sprite 名。
import { Howl } from 'howler';
import type { Fx } from '../engine';
import { channelVolume } from './channels';

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
  | `spell.${Fx}`
  | 'card.buff'
  | 'card.debuff'
  | 'card.bounce'
  | 'card.transform'
  | 'card.burn'
  // 战斗
  | 'combat.swing'
  | 'combat.hit_light'
  | 'combat.hit_heavy'
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
  | 'flow.turn_start'
  | 'flow.turn_end'
  | 'flow.fatigue'
  | 'flow.victory'
  | 'flow.defeat'
  | 'flow.mana';

type SfxDef = { variants: string[]; volume: number };

const MAX_INSTANCES = 4;
const PITCH_JITTER = 0.05;

const silent = (volume = 1): SfxDef => ({ variants: [], volume });

// 音效表。键覆盖 spec 5.7 的全部分类。
export const SFX_TABLE: Record<SfxId, SfxDef> = {
  'ui.hover': silent(0.4),
  'ui.click': silent(),
  'ui.button': silent(),
  'ui.pickup': silent(),
  'ui.drop': silent(),
  'ui.cancel': silent(),
  'card.draw': silent(),
  'card.play': silent(),
  'card.land': silent(),
  'spell.physical': silent(),
  'spell.fire': silent(),
  'spell.frost': silent(),
  'spell.holy': silent(),
  'spell.shadow': silent(),
  'card.buff': silent(),
  'card.debuff': silent(),
  'card.bounce': silent(),
  'card.transform': silent(),
  'card.burn': silent(),
  'combat.swing': silent(),
  'combat.hit_light': silent(),
  'combat.hit_heavy': silent(),
  'combat.hero_hit': silent(),
  'combat.death': silent(),
  'combat.shield_break': silent(),
  'combat.freeze': silent(),
  'combat.unfreeze': silent(),
  'combat.stealth': silent(),
  'combat.heal': silent(),
  'combat.summon': silent(),
  'hero_power.demacia': silent(),
  'hero_power.noxus': silent(),
  'hero_power.ionia': silent(),
  'hero_power.freljord': silent(),
  'flow.turn_start': silent(),
  'flow.turn_end': silent(),
  'flow.fatigue': silent(),
  'flow.victory': silent(),
  'flow.defeat': silent(),
  'flow.mana': silent(0.5),
};

const howls = new Map<string, Howl>();
const playing = new Map<SfxId, number>();

function howlFor(src: string): Howl {
  let h = howls.get(src);
  if (!h) {
    h = new Howl({ src: [src], preload: true });
    howls.set(src, h);
  }
  return h;
}

// 最近播过的音效，调试和测试用（M3 没有真实音效时，从这里能看到每个事件都发出了音效请求）。
export const sfxLog: SfxId[] = [];

export function playSfx(id: SfxId): void {
  sfxLog.push(id);
  if (sfxLog.length > 200) sfxLog.shift();
  const def = SFX_TABLE[id];
  if (def.variants.length === 0) return;
  const count = playing.get(id) ?? 0;
  if (count >= MAX_INSTANCES) return;
  const src = def.variants[Math.floor(Math.random() * def.variants.length)];
  const h = howlFor(src);
  const sound = h.play();
  h.volume(def.volume * channelVolume('sfx'), sound);
  h.rate(1 + (Math.random() * 2 - 1) * PITCH_JITTER, sound);
  playing.set(id, count + 1);
  h.once('end', () => playing.set(id, Math.max(0, (playing.get(id) ?? 1) - 1)), sound);
}
