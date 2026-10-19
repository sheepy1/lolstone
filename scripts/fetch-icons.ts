// 按 scripts/data/card-art.json 拉没有英雄原画的卡、英雄技能、关键词的配图，见 docs/spec.md 5.9。
//
//   node scripts/fetch-icons.ts              已有且完整的文件跳过
//   node scripts/fetch-icons.ts --force      全部重下
//   node scripts/fetch-icons.ts --concurrency 4
//
// 输出：
//   public/art/cards/<卡牌 id>/icon.<扩展名>   场上头像、小图标用的方图（映射表 icon 为 null 时没有）
//   public/art/cards/<卡牌 id>/art.<扩展名>    卡面原画窗口用的图；和 icon 同一个来源时不另存，清单里指向 icon
//   public/art/heropowers/<职业>.png
//   public/art/keywords/<关键词>.png
//   public/art/icons-manifest.json            清单（art/manifest.json 是 fetch-art.ts 的，不共用）
//
// 跳过的判断：上次清单里同一个位置记的地址和这次一样，文件大小和文件头也对。地址里带 Data Dragon 版本号的图标
// 在版本号变了时会重下；改了映射表的来源也会重下。
// 符文之地传说的大图服务器慢（实测单张 20 到 100 秒），单次请求超时放宽到 10 分钟。
// 改了映射表之后，cards/、heropowers/、keywords/ 下清单里不再引用的旧文件会删掉。

import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { latestVersion } from './lib/ddragon.ts';
import { generateQueue, loadCardArtMap, resolveSource } from './lib/art-sources.ts';
import type { ArtSource, Crop } from './lib/art-sources.ts';
import { isUsable, newTally, parseCli, printTally, readManifest, runPool, saveFile, toAbs, writeManifest } from './lib/files.ts';
import { describeError, fetchBytes } from './lib/http.ts';

const MANIFEST = 'art/icons-manifest.json';
const LOR_TIMEOUT_MS = 600_000;
/** 本脚本独占的目录，里面不在清单里的文件都是旧映射留下的。 */
const OWNED_DIRS = ['art/cards', 'art/heropowers', 'art/keywords'];

type Group = 'cards' | 'heroPowers' | 'keywords';
type Slot = 'icon' | 'art';

type IconFile = {
  /** 相对 public/ 的路径，也就是网页里的 URL 路径。 */
  path: string;
  url: string;
  bytes: number;
  source: ArtSource['type'];
};

type IconsManifest = {
  generatedAt: string;
  /** 下载图标时用的 Data Dragon 版本。 */
  ddragonVersion: string;
  lorVersion: string;
  cards: Record<
    string,
    { icon: IconFile | null; art: IconFile | null; crop: Crop; generate?: string; generatePriority?: number }
  >;
  heroPowers: Record<string, { icon: IconFile | null }>;
  keywords: Record<string, { icon: IconFile | null }>;
  failed: { group: Group; id: string; slot: Slot; url: string; error: string }[];
};

type Job = { group: Group; id: string; slot: Slot; source: ArtSource; url: string; path: string };

async function main(): Promise<void> {
  const opts = parseCli();
  const map = await loadCardArtMap();
  const version = await latestVersion();
  const resolve = (src: ArtSource) => resolveSource(src, version, map.lorVersion);

  // 每个位置一个下载任务。卡牌的 art 和 icon 同一个地址时只下 icon，art 在清单里指向同一个文件。
  const jobs: Job[] = [];
  const sameAsIcon = new Set<string>();
  for (const [id, card] of Object.entries(map.cards)) {
    const dir = `art/cards/${id}`;
    const icon = card.icon && resolve(card.icon);
    if (card.icon && icon) jobs.push({ group: 'cards', id, slot: 'icon', source: card.icon, url: icon.url, path: `${dir}/icon${icon.ext}` });
    const art = resolve(card.art);
    if (icon && icon.url === art.url) sameAsIcon.add(id);
    else jobs.push({ group: 'cards', id, slot: 'art', source: card.art, url: art.url, path: `${dir}/art${art.ext}` });
  }
  for (const [id, hp] of Object.entries(map.heroPowers)) {
    const { url, ext } = resolve(hp.icon);
    jobs.push({ group: 'heroPowers', id, slot: 'icon', source: hp.icon, url, path: `art/heropowers/${id.split('.')[0]}${ext}` });
  }
  for (const [id, kw] of Object.entries(map.keywords)) {
    const { url, ext } = resolve(kw.icon);
    jobs.push({ group: 'keywords', id, slot: 'icon', source: kw.icon, url, path: `art/keywords/${id}${ext}` });
  }

  console.log(
    `Data Dragon 版本 ${version}，符文之地传说 ${map.lorVersion}；卡牌 ${Object.keys(map.cards).length} 张、` +
      `英雄技能 ${Object.keys(map.heroPowers).length} 个、关键词 ${Object.keys(map.keywords).length} 个，` +
      `共 ${jobs.length} 个文件，并发 ${opts.concurrency}`,
  );

  const prev = await readManifest<IconsManifest>(MANIFEST);
  const prevFile = (j: Job): IconFile | null | undefined => {
    if (j.group === 'cards') return prev?.cards[j.id]?.[j.slot];
    return prev?.[j.group][j.id]?.icon;
  };

  const tally = newTally();
  const failed: IconsManifest['failed'] = [];

  const results = await runPool(jobs, opts.concurrency, async (j) => {
    const old = prevFile(j);
    if (!opts.force && old && old.url === j.url && old.path === j.path && (await isUsable(j.path, old.bytes))) {
      tally.skipped++;
      tally.totalBytes += old.bytes;
      return { job: j, file: old };
    }
    try {
      const data = await fetchBytes(j.url, j.source.type === 'lor' ? { timeoutMs: LOR_TIMEOUT_MS } : undefined);
      await saveFile(j.path, data);
      tally.downloaded++;
      tally.downloadedBytes += data.byteLength;
      tally.totalBytes += data.byteLength;
      console.log(`  下载 ${j.path}（${(data.byteLength / 1024).toFixed(1)} KB）`);
      return { job: j, file: { path: j.path, url: j.url, bytes: data.byteLength, source: j.source.type } };
    } catch (err) {
      failed.push({ group: j.group, id: j.id, slot: j.slot, url: j.url, error: describeError(err) });
      console.error(`  失败 ${j.group} ${j.id} ${j.slot}：${describeError(err)}`);
      return { job: j, file: null };
    }
  });

  const manifest: IconsManifest = {
    generatedAt: new Date().toISOString(),
    ddragonVersion: version,
    lorVersion: map.lorVersion,
    cards: {},
    heroPowers: {},
    keywords: {},
    failed,
  };
  for (const [id, card] of Object.entries(map.cards)) {
    manifest.cards[id] = {
      icon: null,
      art: null,
      crop: card.art.crop,
      ...(card.generate ? { generate: card.generate, generatePriority: card.generatePriority } : {}),
    };
  }
  for (const id of Object.keys(map.heroPowers)) manifest.heroPowers[id] = { icon: null };
  for (const id of Object.keys(map.keywords)) manifest.keywords[id] = { icon: null };
  for (const { job, file } of results) {
    if (job.group === 'cards') manifest.cards[job.id]![job.slot] = file;
    else manifest[job.group][job.id]!.icon = file;
  }
  for (const id of sameAsIcon) manifest.cards[id]!.art = manifest.cards[id]!.icon;

  await writeManifest(MANIFEST, manifest);
  const removed = await removeStale(new Set(jobs.map((j) => j.path)));

  printTally(`卡牌配图、英雄技能和关键词图标（public/${MANIFEST}）`, tally, failed.length);
  for (const f of failed) console.log(`  - ${f.group} ${f.id} ${f.slot}：${f.error}`);
  if (removed.length > 0) console.log(`  清理   ${removed.length} 个映射表不再用的旧文件：${removed.join('、')}`);
  const toGenerate = generateQueue(map);
  if (toGenerate.length > 0) {
    console.log(`\n以后要生成大图的 ${toGenerate.length} 张，按先后排（现在先用映射表里的替代图）：`);
    for (const [id, c] of toGenerate) console.log(`  ${c.generatePriority ?? '-'}. ${id} ${c.name}：${c.generate}`);
  }
  if (failed.length > 0) process.exitCode = 1;
}

/** 删掉 OWNED_DIRS 下不在 keep 里的文件。keep 是这次所有下载任务的目标路径，下载失败的位置也保留旧文件。 */
async function removeStale(keep: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  for (const dir of OWNED_DIRS) {
    let entries;
    try {
      entries = await readdir(toAbs(dir), { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const publicPath = path.relative(toAbs('.'), path.join(e.parentPath, e.name)).split(path.sep).join('/');
      if (keep.has(publicPath)) continue;
      await rm(toAbs(publicPath));
      removed.push(publicPath);
    }
  }
  return removed;
}

await main();
