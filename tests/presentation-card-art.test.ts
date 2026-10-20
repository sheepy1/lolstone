// 非英雄卡、英雄技能、关键词的配图（spec 5.9，src/assets/cardArt.ts）：映射表覆盖全部卡，算出的本地路径和
// optimize-art.ts 生成的成品一致，裁切算法和对照页一致，缩放规则按场景里的窗口尺寸算，开局预载清单带上本局用得到的配图、
// 不带语音。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardArtOf, heroPowerIconUrl, keywordIconUrl, mappedCardIds, mappedKeywords } from '../src/assets/cardArt';
import { iconUrl, loadingArtUrl, matchManifest, matchVoiceManifest } from '../src/assets/manifest';
import { CARD_POOL, HERO_CLASSES, PRESET_DECKS } from '../src/cards';
import { cropSource } from '../src/scene/artDraw';
import map from '../scripts/data/card-art.json';

const powerIds = new Set(HERO_CLASSES.map((c) => c.heroPower));

// scripts/ 下的文件按 Node 原生跑 TypeScript 的写法带 .ts 后缀导入，tsconfig 不收；这里动态导入，类型检查不跟进去
const ART_SIZES = '../scripts/lib/art-sizes.ts';
const sizes = (await import(ART_SIZES)) as {
  FACE_WINDOW: { w: number; h: number };
  PORTRAIT_SIZE: number;
  OVERSAMPLE: number;
  targetSize: (
    role: string,
    iw: number,
    ih: number,
    crop: { focus: readonly [number, number]; zoom: number },
    portraitFromArt: boolean,
  ) => { w: number; h: number };
};

describe('配图映射', () => {
  it('没有英雄原画的卡（法术、小兵、野怪、亚龙、衍生物）都有配图，英雄卡都没有', () => {
    const need = CARD_POOL.filter((c) => !c.champion && !powerIds.has(c.id)).map((c) => c.id);
    expect(need.filter((id) => !cardArtOf(id))).toEqual([]);
    expect(CARD_POOL.filter((c) => c.champion && cardArtOf(c.id)).map((c) => c.id)).toEqual([]);
    expect(mappedCardIds().filter((id) => !CARD_POOL.some((c) => c.id === id))).toEqual([]);
  });

  it('四个英雄技能都有图标', () => {
    for (const c of HERO_CLASSES) expect(heroPowerIconUrl(c.id)).toBe(`/art/heropowers/${c.id}.webp`);
  });

  it('卡池用到的关键词都有图标', () => {
    const used = new Set(CARD_POOL.flatMap((c) => c.keywords ?? []));
    expect([...used].filter((k) => !keywordIconUrl(k))).toEqual([]);
    expect(mappedKeywords()).toContain('silence');
    expect(mappedKeywords()).toContain('spell_damage');
  });

  it('art 和 icon 同一个来源时指向同一个文件；没有 icon 的卡（德玛西亚士兵）头像从原画裁', () => {
    const minion = cardArtOf('neutral.melee_minion')!;
    expect(minion.art).toBe(minion.icon);
    expect(minion.generate).toBe(true);
    const soldier = cardArtOf('token.demacian_soldier')!;
    expect(soldier.icon).toBeNull();
    expect(soldier.art).toBe('/art/cards/token.demacian_soldier/art.webp');
    const rally = cardArtOf('demacia.rally')!;
    expect(rally.art).toBe('/art/cards/demacia.rally/art.webp');
    expect(rally.icon).toBe('/art/cards/demacia.rally/icon.webp');
    expect(rally.crop).toEqual({ focus: [0.5, 0.5], zoom: 1.55 });
  });

  // 成品在 git 里：拿 optimize-art.ts 写的清单逐项核对，每条地址都有成品，成品都有人用
  const manifestFile = path.join(import.meta.dirname, '../public/art/manifest.json');
  it.skipIf(!existsSync(manifestFile))('和 public/art/manifest.json 记的成品一一对应', () => {
    const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as { files: Record<string, { role: string; width: number; height: number }> };
    const used = new Set<string>();
    const expectFile = (url: string | null, role: string, label: string) => {
      expect(url, label).not.toBeNull();
      const rel = url!.replace(/^\//, '');
      used.add(rel);
      expect(m.files[rel]?.role, `${label} ${rel}`).toBe(role);
    };
    for (const id of mappedCardIds()) {
      const a = cardArtOf(id)!;
      if (a.icon) expectFile(a.icon, 'card_icon', id);
      if (a.art !== a.icon) expectFile(a.art, 'card_art', id);
    }
    for (const c of HERO_CLASSES) expectFile(heroPowerIconUrl(c.id), 'hero_power', c.id);
    for (const k of mappedKeywords()) expectFile(keywordIconUrl(k), 'keyword', k);
    const champions = new Set([...HERO_CLASSES.map((c) => c.champion), ...CARD_POOL.flatMap((c) => (c.champion ? [c.champion] : []))]);
    for (const key of champions) {
      expectFile(iconUrl(key), 'hero_icon', key);
      expectFile(loadingArtUrl(key), 'hero_loading', key);
    }
    expect(Object.keys(m.files).filter((f) => !used.has(f))).toEqual([]);
    // 缩过的原画取景区域不小于窗口；小图标、头像、竖版原画不缩
    for (const [rel, f] of Object.entries(m.files)) {
      if (f.role === 'hero_icon') expect([f.width, f.height], rel).toEqual([128, 128]);
      if (f.role === 'hero_loading') expect([f.width, f.height], rel).toEqual([308, 560]);
      if (f.role === 'card_art') expect(Math.min(f.width, f.height), rel).toBeGreaterThanOrEqual(sizes.FACE_WINDOW.h);
    }
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

describe('成品尺寸规则（scripts/lib/art-sizes.ts，optimize-art.ts 按它缩原图）', () => {
  it('窗口尺寸和场景一致：卡面原画窗口 380×327（cardFrameArt.ts 的 ART），方形头像 256', () => {
    expect(sizes.FACE_WINDOW).toEqual({ w: 380, h: 327 });
    expect(sizes.PORTRAIT_SIZE).toBe(256);
    expect(sizes.OVERSAMPLE).toBeGreaterThanOrEqual(1);
  });

  it('原画缩到取景区域是窗口的 OVERSAMPLE 倍，整张等比；取景已经不大于窗口的不缩，别的角色不缩', () => {
    const k = sizes.OVERSAMPLE;
    // 符文之地传说 2048×1024 整张取景：按高度铺满，缩到高 327k
    const lor = sizes.targetSize('card_art', 2048, 1024, { focus: [0.5, 0.5], zoom: 1 }, false);
    expect(lor.h).toBe(Math.round(327 * k));
    expect(lor.w / lor.h).toBeCloseTo(2, 1);
    // 1024×1024 放大 1.55 倍取景：取景区域 1024/1.55 宽，缩到 380k 宽
    const spell = sizes.targetSize('card_art', 1024, 1024, { focus: [0.5, 0.5], zoom: 1.55 }, false);
    expect(spell.w).toBe(Math.round((1024 * 380 * k) / (1024 / 1.55)));
    expect(spell.w).toBe(spell.h);
    // 方形头像也从这张裁时，取两个要求里更高的：256k 的方形取景比 380×327 的窗口要求低，结果不变
    expect(sizes.targetSize('card_art', 2048, 1024, { focus: [0.5, 0.5], zoom: 1 }, true)).toEqual(lor);
    // 128×128 的峡谷头像放进窗口本来就要放大，保持原尺寸
    expect(sizes.targetSize('card_art', 128, 128, { focus: [0.5, 0.5], zoom: 1 }, false)).toEqual({ w: 128, h: 128 });
    expect(sizes.targetSize('hero_loading', 308, 560, { focus: [0.5, 0.2], zoom: 1 }, false)).toEqual({ w: 308, h: 560 });
    expect(sizes.targetSize('keyword', 64, 64, { focus: [0.5, 0.5], zoom: 1 }, false)).toEqual({ w: 64, h: 64 });
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

  it('只有图，没有语音；语音另一份清单，登场台词在前、死亡台词在后，英雄和图的英雄一致', () => {
    expect(entries.filter((e) => e.kind === 'voice_choose' || e.kind === 'voice_ban')).toEqual([]);
    const voices = matchVoiceManifest([PRESET_DECKS.demacia!, PRESET_DECKS.freljord!], ['demacia', 'freljord']);
    const champions = entries.filter((e) => e.kind === 'icon').map((e) => e.key);
    expect(champions).toContain('Garen');
    expect(champions).toContain('Ashe');
    expect(voices.map((e) => e.kind)).toEqual([...champions.map(() => 'voice_choose'), ...champions.map(() => 'voice_ban')]);
    expect(voices.filter((e) => e.kind === 'voice_choose').map((e) => e.key)).toEqual(champions);
    expect(voices.map((e) => e.url)).toContain('/audio/voice/garen/choose.ogg');
  });
});
