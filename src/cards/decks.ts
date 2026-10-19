// 预组卡组（cards-v1.md「预组卡组」）。M1 只有德玛西亚和弗雷尔卓德。
import type { HeroClass } from '../engine/state';

function twoOf(ids: string[]): string[] {
  return ids.flatMap((id) => [id, id]);
}

export const PRESET_DECKS: Partial<Record<HeroClass, string[]>> = {
  // 铺场
  demacia: twoOf([
    'demacia.lucian', 'demacia.poppy', 'demacia.xinzhao', 'demacia.quinn', 'demacia.lux', 'demacia.sona',
    'demacia.jarvaniv', 'demacia.galio', 'demacia.kayle', 'demacia.light_shield', 'demacia.iron_oath',
    'demacia.rally', 'demacia.demacian_justice',
    'neutral.rift_scuttler', 'neutral.red_brambleback',
  ]),
  // 控制
  freljord: twoOf([
    'freljord.olaf', 'freljord.udyr', 'freljord.braum', 'freljord.sejuani', 'freljord.anivia', 'freljord.tryndamere',
    'freljord.ornn', 'freljord.lissandra', 'freljord.volibear', 'freljord.winters_approach',
    'freljord.glacial_fissure', 'freljord.crystal_arrow', 'freljord.blizzard',
    'neutral.ancient_krug', 'neutral.super_minion',
  ]),
};
