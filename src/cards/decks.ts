// 预组卡组（cards-v1.md「预组卡组」）。
import type { HeroClass } from '../engine/state';

function twoOf(ids: string[]): string[] {
  return ids.flatMap((id) => [id, id]);
}

export const PRESET_DECKS: Record<HeroClass, string[]> = {
  // 铺场
  demacia: twoOf([
    'demacia.lucian', 'demacia.poppy', 'demacia.xinzhao', 'demacia.quinn', 'demacia.lux', 'demacia.sona',
    'demacia.jarvaniv', 'demacia.galio', 'demacia.kayle', 'demacia.light_shield', 'demacia.iron_oath',
    'demacia.rally', 'demacia.demacian_justice',
    'neutral.rift_scuttler', 'neutral.red_brambleback',
  ]),
  // 快攻
  noxus: twoOf([
    'noxus.annie', 'noxus.kled', 'noxus.talon', 'noxus.draven', 'noxus.katarina', 'noxus.vladimir', 'noxus.samira',
    'noxus.sion', 'noxus.flying_axe', 'noxus.blood_rage', 'noxus.execute', 'noxus.decimate', 'noxus.might_of_noxus',
    'neutral.caster_minion', 'neutral.murk_wolf',
  ]),
  // 节奏
  ionia: twoOf([
    'ionia.kennen', 'ionia.akali', 'ionia.karma', 'ionia.zed', 'ionia.yasuo', 'ionia.leesin', 'ionia.masteryi',
    'ionia.yone', 'ionia.syndra', 'ionia.recall', 'ionia.spirit_rush', 'ionia.meditate', 'ionia.last_breath',
    'neutral.blue_sentinel', 'neutral.velkoz',
  ]),
  // 控制
  freljord: twoOf([
    'freljord.olaf', 'freljord.udyr', 'freljord.braum', 'freljord.sejuani', 'freljord.anivia', 'freljord.tryndamere',
    'freljord.ornn', 'freljord.lissandra', 'freljord.volibear', 'freljord.winters_approach',
    'freljord.glacial_fissure', 'freljord.crystal_arrow', 'freljord.blizzard',
    'neutral.ancient_krug', 'neutral.super_minion',
  ]),
};
