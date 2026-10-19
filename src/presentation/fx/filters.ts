// 滤镜预设（spec 6.1）。同一种预设共用一个滤镜实例。
import { ColorMatrixFilter, type Filter } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';

const glows = new Map<number, Filter>();

// 发光边：能出的牌、能攻击的随从（绿），合法目标（红）。
export function glowFilter(color: number): Filter {
  let f = glows.get(color);
  if (!f) {
    f = new GlowFilter({ color, distance: 14, outerStrength: 2.4, innerStrength: 0, quality: 0.2 });
    glows.set(color, f);
  }
  return f;
}

// 变灰：死亡、不可用。
export function grayscaleFilter(): ColorMatrixFilter {
  const f = new ColorMatrixFilter();
  f.desaturate();
  return f;
}
