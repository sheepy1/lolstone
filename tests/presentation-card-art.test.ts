// 非英雄卡、英雄技能、关键词的配图（spec 5.9，src/assets/cardArt.ts）：映射表覆盖全部卡，算出的本地路径和
// fetch-icons.ts 下载的位置一致，裁切算法和对照页一致，开局预载清单带上本局用得到的配图。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardArtOf, heroPowerIconUrl, keywordIconUrl, mappedCardIds, mappedKeywords, sourceExt } from '../src/assets/cardArt';
import { matchManifest } from '../src/assets/manifest';
import { CARD_POOL, HERO_CLASSES, PRESET_DECKS } from '../src/cards';
import { cropSource } from '../src/scene/artDraw';
import map from '../scripts/data/card-art.json';

const powerIds = new Set(HERO_CLASSES.map((c) => c.heroPower));

type ArtSource = Parameters<typeof sourceExt>[0];
// scripts/ 下的文件按 Node 原生跑 TypeScript 的写法带 .ts 后缀导入，tsconfig 不收；这里动态导入，类型检查不跟进去
const ART_SOURCES = '../scripts/lib/art-sources.ts';
const { resolveSource } = (await import(ART_SOURCES)) as {
  resolveSource: (src: ArtSource, ddVersion: string, lorVersion: string) => { url: string; ext: string };
};

describe('配图映射', () => {
  it('没有英雄原画的卡（法术、小兵、野怪、亚龙、衍生物）都有配图，英雄卡都没有', () => {
    const need = CARD_POOL.filter((c) => !c.champion && !powerIds.has(c.id)).map((c) => c.id);
    expect(need.filter((id) => !cardArtOf(id))).toEqual([]);
    expect(CARD_POOL.filter((c) => c.champion && cardArtOf(c.id)).map((c) => c.id)).toEqual([]);
    expect(mappedCardIds().filter((id) => !CARD_POOL.some((c) => c.id === id))).toEqual([]);
  });

  it('四个英雄技能都有图标', () => {
    for (const c of HERO_CLASSES) expect(heroPowerIconUrl(c.id)).toBe(`/art/heropowers/${c.id}.png`);
  });

  it('卡池用到的关键词都有图标', () => {
    const used = new Set(CARD_POOL.flatMap((c) => c.keywords ?? []));
    expect([...used].filter((k) => !keywordIconUrl(k))).toEqual([]);
    expect(mappedKeywords()).toContain('silence');
    expect(mappedKeywords()).toContain('spell_damage');
  });

  it('扩展名和 fetch-icons.ts 的 resolveSource 一致', () => {
    const all: ArtSource[] = [
      ...Object.values(map.cards).flatMap((c) => [c.art as ArtSource, ...(c.icon ? [c.icon as ArtSource] : [])]),
      ...Object.values(map.heroPowers).map((h) => h.icon as ArtSource),
      ...Object.values(map.keywords).map((k) => k.icon as ArtSource),
    ];
    for (const src of all) expect(sourceExt(src), JSON.stringify(src)).toBe(resolveSource(src, '1.0.0', map.lorVersion).ext);
  });

  it('art 和 icon 同一个来源时指向同一个文件；没有 icon 的卡（德玛西亚士兵）头像从原画裁', () => {
    const minion = cardArtOf('neutral.melee_minion')!;
    expect(minion.art).toBe(minion.icon);
    expect(minion.generate).toBe(true);
    const soldier = cardArtOf('token.demacian_soldier')!;
    expect(soldier.icon).toBeNull();
    expect(soldier.art).toBe('/art/cards/token.demacian_soldier/art.png');
    const rally = cardArtOf('demacia.rally')!;
    expect(rally.art).toBe('/art/cards/demacia.rally/art.png');
    expect(rally.crop).toEqual({ focus: [0.5, 0.5], zoom: 1.55 });
  });

  // 素材不进 git：本地跑过 pnpm fetch:icons 时，拿它写的清单逐项核对路径
  const manifestFile = path.join(import.meta.dirname, '../public/art/icons-manifest.json');
  it.skipIf(!existsSync(manifestFile))('和本地 icons-manifest.json 记的文件一一对应', () => {
    const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
      cards: Record<string, { icon: { path: string } | null; art: { path: string } | null }>;
      heroPowers: Record<string, { icon: { path: string } | null }>;
      keywords: Record<string, { icon: { path: string } | null }>;
    };
    for (const [id, e] of Object.entries(m.cards)) {
      const a = cardArtOf(id)!;
      expect(a.art, id).toBe(`/${e.art!.path}`);
      expect(a.icon, id).toBe(e.icon ? `/${e.icon.path}` : null);
    }
    for (const [id, e] of Object.entries(m.heroPowers)) expect(heroPowerIconUrl(id.split('.')[0] as never)).toBe(`/${e.icon!.path}`);
    for (const [id, e] of Object.entries(m.keywords)) expect(keywordIconUrl(id)).toBe(`/${e.icon!.path}`);
  });
});

describe('裁切（和 scripts/art-review.ts 对照页的 CSS 同一套算法）', () => {
  it('方图放进方窗口、不放大：整张', () => {
    expect(cropSource(128, 128, 256, 256, { focus: [0.5, 0.5], zoom: 1 })).toEqual({ x: 0, y: 0, w: 128, h: 128 });
  });

  it('横图放进窗口：按高度铺满，focus 决定左右取哪一段，落在原图以内', () => {
    const left = cropSource(2048, 1024, 380, 327, { focus: [0, 0.5], zoom: 1 });
    expect(left.x).toBeCloseTo(0);
    expect(left.h).toBeCloseTo(1024);
    const right = cropSource(2048, 1024, 380, 327, { focus: [1, 0.5], zoom: 1 });
    expect(right.x + right.w).toBeCloseTo(2048);
  });

  it('zoom 以 focus 为中心放大：取景缩小到 1/zoom，focus 在中心时取景也居中', () => {
    const whole = cropSource(2048, 1024, 380, 327, { focus: [0.5, 0.5], zoom: 1 });
    const z = cropSource(2048, 1024, 380, 327, { focus: [0.5, 0.5], zoom: 1.55 });
    expect(z.w).toBeCloseTo(whole.w / 1.55);
    expect(z.x + z.w / 2).toBeCloseTo(1024);
    expect(z.y + z.h / 2).toBeCloseTo(512);
  });

  it('所有卡的取景都落在原图以内（按来源的典型尺寸算）', () => {
    const SIZE: Record<string, [number, number]> = { lor: [2048, 1024], 'ddragon-splash': [1215, 717], cdragon: [128, 128], 'ddragon-item': [64, 64] };
    for (const id of mappedCardIds()) {
      const a = cardArtOf(id)!;
      const [iw, ih] = SIZE[(map.cards as Record<string, { art: { type: string } }>)[id]!.art.type] ?? [512, 512];
      const r = cropSource(iw, ih, 380, 327, a.crop);
      expect(r.x, id).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y, id).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w, id).toBeLessThanOrEqual(iw + 1e-6);
      expect(r.y + r.h, id).toBeLessThanOrEqual(ih + 1e-6);
    }
  });
});

describe('开局预载清单', () => {
  const entries = matchManifest([PRESET_DECKS.demacia!, PRESET_DECKS.freljord!], ['demacia', 'freljord']);
  const urls = entries.map((e) => e.url);

  it('带上卡组里非英雄卡的原画和头像、衍生物、法力药水、两个英雄技能图标、关键词图标', () => {
    for (const id of new Set([...PRESET_DECKS.demacia!, ...PRESET_DECKS.freljord!])) {
      const a = cardArtOf(id);
      if (a) expect(urls, id).toContain(a.art);
    }
    // 召集和嘉文四世召唤的德玛西亚士兵、冰凤凰蛋（艾尼维亚亡语）、后手的法力药水
    expect(urls).toContain(cardArtOf('token.demacian_soldier')!.art);
    expect(urls).toContain(cardArtOf('token.anivia_egg')!.art);
    expect(urls).toContain(cardArtOf('token.mana_potion')!.art);
    expect(urls).toContain(heroPowerIconUrl('demacia'));
    expect(urls).toContain(heroPowerIconUrl('freljord'));
    expect(urls).not.toContain(heroPowerIconUrl('noxus'));
    for (const k of mappedKeywords()) expect(urls).toContain(keywordIconUrl(k));
  });

  it('不带别的职业的卡，同一个文件只载一次', () => {
    expect(urls).not.toContain(cardArtOf('noxus.execute')!.art);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
