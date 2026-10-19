// 拉英雄的选用语音和禁用语音到 public/audio/voice/<key 小写>/，见 docs/spec.md 5.9。
// 选用语音做随从登场台词，禁用语音做死亡台词（spec 5.7）。
//
//   node scripts/fetch-voice.ts            已有且完整的文件跳过
//   node scripts/fetch-voice.ts --force    全部重下
//   node scripts/fetch-voice.ts --concurrency 4
//
// 先拉 zh_cn 目录的中文语音，拿不到（404）时退到 default 目录的英文语音，清单里 lang 标成 en。
// 跳过的文件沿用上次清单记的语言；中文语音后来补上了的话，用 --force 重下。

import { CHAMPION_KEYS, assetDir } from './lib/champions.ts';
import { exitOnMissing, latestVersion, loadChampions, resolveKeys } from './lib/ddragon.ts';
import type { ChampionInfo } from './lib/ddragon.ts';
import { isUsable, newTally, parseCli, printTally, readManifest, runPool, saveFile, writeManifest } from './lib/files.ts';
import { HttpError, describeError, fetchBytes, fetchJson } from './lib/http.ts';

const MANIFEST = 'audio/voice/manifest.json';
const CDRAGON = 'https://raw.communitydragon.org/latest';
const GAME_DATA = `${CDRAGON}/plugins/rcp-be-lol-game-data/global`;

/** CommunityDragon 的目录名和清单里记的语言。 */
const LOCALES = [
  { dir: 'zh_cn', lang: 'zh' },
  { dir: 'default', lang: 'en' },
] as const;

type Lang = (typeof LOCALES)[number]['lang'];

const KINDS = {
  choose: 'champion-choose-vo',
  ban: 'champion-ban-vo',
} as const;

type VoiceKind = keyof typeof KINDS;

type VoiceFile = { path: string; url: string; bytes: number; lang: Lang; version: string | null };

type VoiceEntry = {
  key: string;
  dir: string;
  id: number;
  name: string;
  /** 选用语音，做登场台词。下载失败时为 null。 */
  choose: VoiceFile | null;
  /** 禁用语音，做死亡台词。下载失败时为 null。 */
  ban: VoiceFile | null;
};

type VoiceManifest = {
  generatedAt: string;
  source: 'communitydragon';
  /** 查数字 id 用的 Data Dragon 版本。 */
  ddragonVersion: string;
  /** CommunityDragon latest 当时对应的游戏版本，取不到时为 null。 */
  cdragonVersion: string | null;
  champions: VoiceEntry[];
  /** 至少有一条语音用了英文的英雄。 */
  englishFallback: { key: string; name: string; kinds: VoiceKind[] }[];
  failed: { key: string; kind: VoiceKind; error: string }[];
};

async function cdragonVersion(): Promise<string | null> {
  try {
    return (await fetchJson<{ version: string }>(`${CDRAGON}/content-metadata.json`)).version ?? null;
  } catch {
    return null;
  }
}

/** 按 LOCALES 顺序试，前一个是不可重试的错误（比如 404）时换下一个。 */
async function fetchVoice(kind: VoiceKind, id: number): Promise<{ data: Uint8Array; url: string; lang: Lang }> {
  const errors: string[] = [];
  for (const { dir, lang } of LOCALES) {
    const url = `${GAME_DATA}/${dir}/v1/${KINDS[kind]}/${id}.ogg`;
    try {
      return { data: await fetchBytes(url), url, lang };
    } catch (err) {
      errors.push(`${dir}: ${describeError(err)}`);
      // 网络错误重试完还失败，说明不是"这个语言没有"，换语言也没用。
      if (!(err instanceof HttpError) || err.status >= 500) break;
    }
  }
  throw new Error(errors.join('；'));
}

async function main(): Promise<void> {
  const opts = parseCli();
  const ddragonVersion = await latestVersion();
  const version = await cdragonVersion();
  console.log(
    `Data Dragon 版本 ${ddragonVersion}，CommunityDragon ${version ?? '版本未知'}，` +
      `英雄 ${CHAMPION_KEYS.length} 个，并发 ${opts.concurrency}`,
  );

  const { found, missing } = resolveKeys(CHAMPION_KEYS, await loadChampions(ddragonVersion));
  exitOnMissing(missing, ddragonVersion);

  const prev = await readManifest<VoiceManifest>(MANIFEST);
  const prevByKey = new Map(prev?.champions.map((c) => [c.key, c]));
  const tally = newTally();
  const failed: VoiceManifest['failed'] = [];

  const jobs = found.flatMap((champ) => (Object.keys(KINDS) as VoiceKind[]).map((kind) => ({ champ, kind })));

  const results = await runPool(jobs, opts.concurrency, async ({ champ, kind }) => {
    const path = `audio/voice/${assetDir(champ.key)}/${kind}.ogg`;
    const old = prevByKey.get(champ.key)?.[kind];
    if (!opts.force && old && (await isUsable(path, old.bytes))) {
      tally.skipped++;
      tally.totalBytes += old.bytes;
      return { champ, kind, file: old };
    }
    try {
      const { data, url, lang } = await fetchVoice(kind, champ.id);
      await saveFile(path, data);
      tally.downloaded++;
      tally.downloadedBytes += data.byteLength;
      tally.totalBytes += data.byteLength;
      console.log(`  下载 ${path}（${lang}，${(data.byteLength / 1024).toFixed(1)} KB）`);
      return { champ, kind, file: { path, url, bytes: data.byteLength, lang, version } };
    } catch (err) {
      failed.push({ key: champ.key, kind, error: describeError(err) });
      console.error(`  失败 ${champ.key} ${kind}：${describeError(err)}`);
      return { champ, kind, file: null };
    }
  });

  const entries = new Map<string, VoiceEntry>();
  const entryFor = (c: ChampionInfo) => {
    let e = entries.get(c.key);
    if (!e) {
      e = { key: c.key, dir: assetDir(c.key), id: c.id, name: c.name, choose: null, ban: null };
      entries.set(c.key, e);
    }
    return e;
  };
  for (const r of results) entryFor(r.champ)[r.kind] = r.file;

  const englishFallback = [...entries.values()]
    .map((e) => ({
      key: e.key,
      name: e.name,
      kinds: (Object.keys(KINDS) as VoiceKind[]).filter((k) => e[k]?.lang === 'en'),
    }))
    .filter((e) => e.kinds.length > 0);

  await writeManifest(MANIFEST, {
    generatedAt: new Date().toISOString(),
    source: 'communitydragon',
    ddragonVersion,
    cdragonVersion: version,
    champions: [...entries.values()],
    englishFallback,
    failed,
  } satisfies VoiceManifest);

  printTally(`英雄语音（public/${MANIFEST}）`, tally, failed.length);
  for (const f of failed) console.log(`  - ${f.key} ${f.kind}：${f.error}`);
  console.log(`  用了英文语音的英雄 ${englishFallback.length} 个`);
  for (const e of englishFallback) console.log(`  - ${e.key}（${e.name}）：${e.kinds.join('、')}`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
