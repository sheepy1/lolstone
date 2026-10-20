// 拉英雄头像和竖版原画的原图到 assets-src/art/<key 小写>/（不进 git），见 docs/spec.md 5.9。
// 下完再跑 node scripts/optimize-art.ts，把原图转成 WebP 放到 public/art/（进 git，网页用的就是它）。
//
//   node scripts/fetch-art.ts              已有且完整的文件跳过
//   node scripts/fetch-art.ts --force      全部重下
//   node scripts/fetch-art.ts --concurrency 4
//
// 头像的地址带版本号，Data Dragon 版本号变了时会重下。竖版原画只有不带版本号的地址
// （cdn/img/champion/loading/，带版本号的路径返回 403），清单里 version 记 null，版本号变了也不重下。

import { CHAMPION_KEYS, assetDir } from './lib/champions.ts';
import { DDRAGON, exitOnMissing, latestVersion, loadChampions, resolveKeys } from './lib/ddragon.ts';
import type { ChampionInfo } from './lib/ddragon.ts';
import { ASSETS_SRC_DIR, isUsable, newTally, parseCli, printTally, readManifest, runPool, saveFile, writeManifest } from './lib/files.ts';
import { describeError, fetchBytes } from './lib/http.ts';

const MANIFEST = 'art/manifest.json';

type ArtFile = {
  /** 相对 assets-src/ 的路径。 */
  path: string;
  url: string;
  bytes: number;
  /** 下载时用的 Data Dragon 版本。地址不带版本号的素材（竖版原画）为 null。 */
  version: string | null;
};

type ArtEntry = {
  key: string;
  dir: string;
  id: number;
  name: string;
  title: string;
  /** 头像 120×120。下载失败时为 null。 */
  icon: ArtFile | null;
  /** 竖版原画 308×560。下载失败时为 null。 */
  loading: ArtFile | null;
};

type ArtManifest = {
  generatedAt: string;
  source: 'ddragon';
  version: string;
  champions: ArtEntry[];
  failed: { key: string; asset: 'icon' | 'loading'; url: string; error: string }[];
};

const ASSETS = {
  icon: (v: string, key: string) => ({
    url: `${DDRAGON}/cdn/${v}/img/champion/${key}.png`,
    path: `art/${assetDir(key)}/icon.png`,
    version: v as string | null,
  }),
  loading: (_v: string, key: string) => ({
    url: `${DDRAGON}/cdn/img/champion/loading/${key}_0.jpg`,
    path: `art/${assetDir(key)}/loading.jpg`,
    version: null,
  }),
} as const;

type AssetKind = keyof typeof ASSETS;

async function main(): Promise<void> {
  const opts = parseCli();
  const version = await latestVersion();
  console.log(`Data Dragon 版本 ${version}，英雄 ${CHAMPION_KEYS.length} 个，并发 ${opts.concurrency}`);

  const { found, missing } = resolveKeys(CHAMPION_KEYS, await loadChampions(version));
  exitOnMissing(missing, version);

  const prev = await readManifest<ArtManifest>(MANIFEST, ASSETS_SRC_DIR);
  const prevByKey = new Map(prev?.champions.map((c) => [c.key, c]));
  const tally = newTally();
  const failed: ArtManifest['failed'] = [];

  const jobs = found.flatMap((champ) => (Object.keys(ASSETS) as AssetKind[]).map((kind) => ({ champ, kind })));

  const results = await runPool(jobs, opts.concurrency, async ({ champ, kind }) => {
    const { url, path, version: fileVersion } = ASSETS[kind](version, champ.key);
    const old = prevByKey.get(champ.key)?.[kind];
    if (!opts.force && old && old.version === fileVersion && (await isUsable(path, old.bytes, ASSETS_SRC_DIR))) {
      tally.skipped++;
      tally.totalBytes += old.bytes;
      return { champ, kind, file: old };
    }
    try {
      const data = await fetchBytes(url);
      await saveFile(path, data, ASSETS_SRC_DIR);
      tally.downloaded++;
      tally.downloadedBytes += data.byteLength;
      tally.totalBytes += data.byteLength;
      console.log(`  下载 ${path}（${(data.byteLength / 1024).toFixed(1)} KB）`);
      return { champ, kind, file: { path, url, bytes: data.byteLength, version: fileVersion } };
    } catch (err) {
      failed.push({ key: champ.key, asset: kind, url, error: describeError(err) });
      console.error(`  失败 ${champ.key} ${kind}：${describeError(err)}`);
      return { champ, kind, file: null };
    }
  });

  const entries = new Map<string, ArtEntry>();
  const entryFor = (c: ChampionInfo) => {
    let e = entries.get(c.key);
    if (!e) {
      e = { key: c.key, dir: assetDir(c.key), id: c.id, name: c.name, title: c.title, icon: null, loading: null };
      entries.set(c.key, e);
    }
    return e;
  };
  for (const r of results) entryFor(r.champ)[r.kind] = r.file;

  await writeManifest(
    MANIFEST,
    {
      generatedAt: new Date().toISOString(),
      source: 'ddragon',
      version,
      champions: [...entries.values()],
      failed,
    } satisfies ArtManifest,
    ASSETS_SRC_DIR,
  );

  printTally(`英雄美术原图（assets-src/${MANIFEST}）`, tally, failed.length);
  for (const f of failed) console.log(`  - ${f.key} ${f.asset}：${f.error}`);
  console.log('  接着跑 node scripts/optimize-art.ts 生成 public/art/ 的成品');
  if (failed.length > 0) process.exitCode = 1;
}

await main();
