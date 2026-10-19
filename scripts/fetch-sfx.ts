// 按 scripts/data/audio-sources.json 下载音效和音乐的原始素材到 assets-src/audio/sources/<来源 id>/，见 docs/spec.md 5.7、5.9。
// 下载完再跑 normalize-audio.ts 统一响度，成品输出到 public/audio/sfx/ 和 public/audio/music/。
//
//   node scripts/fetch-sfx.ts              已下载且完整的跳过
//   node scripts/fetch-sfx.ts --force      全部重下
//   node scripts/fetch-sfx.ts --record     把下载到的字节数和 sha256 写回 audio-sources.json（新加来源时用）
//
// 来源只收 CC0：每个来源记了页面、作者、授权和授权写在哪里，加新来源前先在页面上确认授权。
// 下载支持断点续传：OpenGameArt 的大文件常常下到一半断开，脚本从断开的位置接着下。

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import type { Source } from './lib/audio.ts';
import { SOURCES_DIR, SOURCES_JSON, candidateInputs, inputPath, loadSources, run, sha256File } from './lib/audio.ts';
import { formatBytes, runPool } from './lib/files.ts';

const ATTEMPTS = 6;
/** 连续这么久没收到数据就断开重连，从已下载的位置续传。 */
const IDLE_MS = 30_000;
const CONCURRENCY = 4;

async function fileSize(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

/** 下载一次：从 .part 已有的长度续传，直到 maxBytes 或文件结尾。 */
async function downloadOnce(src: Source, part: string): Promise<void> {
  const have = (await fileSize(part)) ?? 0;
  const end = src.maxBytes ? src.maxBytes - 1 : undefined;
  if (end !== undefined && have > end) return;
  const headers: Record<string, string> = { 'User-Agent': 'melol-fetch-sfx' };
  if (have > 0 || end !== undefined) headers.Range = `bytes=${have}-${end ?? ''}`;

  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), IDLE_MS);
  const res = await fetch(src.url, { headers, signal: ctrl.signal });
  if (res.status === 416 && have > 0) {
    clearTimeout(idle);
    return; // 已经下完
  }
  if (!res.ok || !res.body) {
    clearTimeout(idle);
    throw new Error(`HTTP ${res.status} ${src.url}`);
  }
  // 服务器不支持 Range 时返回 200 和整个文件，只能从头写
  const append = res.status === 206 && have > 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  let written = 0;
  body.on('data', (chunk: Buffer) => {
    written += chunk.length;
    clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(), IDLE_MS);
    // 服务器忽略 Range 时自己截断
    if (end !== undefined && !append && written > end + 1) body.destroy();
  });
  try {
    await pipeline(body, createWriteStream(part, { flags: append ? 'a' : 'w' }));
  } catch (err) {
    if (!(end !== undefined && written > end)) throw err;
  } finally {
    clearTimeout(idle);
  }
}

async function download(id: string, src: Source, file: string): Promise<void> {
  const part = `${file}.part`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await downloadOnce(src, part);
      const size = (await fileSize(part)) ?? 0;
      if (src.maxBytes && size > src.maxBytes) {
        // 不支持 Range 的服务器多给了数据，截到 maxBytes
        await truncate(part, src.maxBytes);
      }
      await rename(part, file);
      return;
    } catch (err) {
      lastErr = err;
      const size = (await fileSize(part)) ?? 0;
      console.log(`  ${id}：第 ${attempt} 次下载中断（已有 ${formatBytes(size)}），续传`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 已下载的文件能不能直接用：存在，字节数和 sha256 跟清单记的一致。清单没记时只要存在就算。 */
async function isComplete(src: Source, file: string): Promise<boolean> {
  const size = await fileSize(file);
  if (size === null) return false;
  if (src.bytes !== undefined && size !== src.bytes) return false;
  if (src.sha256 !== undefined && (await sha256File(file)) !== src.sha256) return false;
  return true;
}

async function extract(src: Source, file: string, dir: string, digest: string): Promise<void> {
  const xdir = path.join(dir, 'x');
  const marker = path.join(xdir, '.extracted');
  try {
    if ((await readFile(marker, 'utf8')) === digest) return;
  } catch {
    // 没解压过
  }
  await rm(xdir, { recursive: true, force: true });
  await mkdir(xdir, { recursive: true });
  if (src.archive === 'zip') await run('unzip', ['-qo', file, '-d', xdir]);
  // macOS 自带的 tar 是 bsdtar，能解 7z；别的系统装 7z 命令
  else await run('tar', ['-xf', file, '-C', xdir]).catch(() => run('7z', ['x', '-y', `-o${xdir}`, file]));
  await writeFile(marker, digest);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { force: { type: 'boolean', default: false }, record: { type: 'boolean', default: false } },
  });
  const data = await loadSources();
  const used = new Set(data.sounds.flatMap((s) => s.candidates.flatMap((c) => candidateInputs(c).map((i) => i.source))));
  const unused = Object.keys(data.sources).filter((id) => !used.has(id));
  const ids = Object.keys(data.sources).filter((id) => used.has(id));
  console.log(`来源 ${ids.length} 个，并发 ${CONCURRENCY}`);

  let downloaded = 0;
  let skipped = 0;
  const failed: { id: string; error: string }[] = [];
  const mismatched: string[] = [];

  await runPool(ids, CONCURRENCY, async (id) => {
    const src = data.sources[id]!;
    const dir = path.join(SOURCES_DIR, id);
    const file = path.join(dir, src.file);
    await mkdir(dir, { recursive: true });
    try {
      if (!values.force && (await isComplete(src, file))) {
        skipped++;
      } else {
        if (values.force) await rm(`${file}.part`, { force: true });
        await download(id, src, file);
        downloaded++;
        const size = (await fileSize(file)) ?? 0;
        console.log(`  下载 ${id}/${src.file}（${formatBytes(size)}）`);
      }
      const size = (await fileSize(file)) ?? 0;
      const digest = await sha256File(file);
      if (values.record) {
        src.bytes = size;
        src.sha256 = digest;
      } else if ((src.bytes !== undefined && src.bytes !== size) || (src.sha256 !== undefined && src.sha256 !== digest)) {
        mismatched.push(id);
        throw new Error(`下载到的文件和清单记的不一致（${formatBytes(size)}），上游可能换了文件，核对后用 --record 更新`);
      }
      if (src.archive) await extract(src, file, dir, digest);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      console.error(`  失败 ${id}：${failed.at(-1)!.error}`);
    }
  });

  // 每个候选引用的文件都要在
  const missing: string[] = [];
  for (const sound of data.sounds) {
    for (const c of sound.candidates) {
      for (const input of candidateInputs(c)) {
        if (failed.some((f) => f.id === input.source)) continue;
        if ((await fileSize(inputPath(data.sources, input))) === null) missing.push(`${sound.id}：${input.source}/${input.member}`);
      }
    }
  }

  if (values.record) {
    await writeFile(SOURCES_JSON, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`已把字节数和 sha256 写回 ${path.relative(process.cwd(), SOURCES_JSON)}`);
  }

  console.log(`\n音效和音乐原始素材（assets-src/audio/sources/）`);
  console.log(`  新下载 ${downloaded} 个来源，跳过 ${skipped} 个（已存在且完整），失败 ${failed.length} 个`);
  for (const f of failed) console.log(`  - ${f.id}：${f.error}`);
  if (unused.length) console.log(`  清单里没被任何候选用到的来源：${unused.join('、')}`);
  console.log(`  候选引用的文件缺失 ${missing.length} 个`);
  for (const m of missing) console.log(`  - ${m}`);
  const dirs = await readdir(SOURCES_DIR).catch(() => [] as string[]);
  const stale = dirs.filter((d) => !(d in data.sources));
  if (stale.length) console.log(`  清单里已经没有、本地还留着的来源目录：${stale.join('、')}（可以删掉）`);
  if (failed.length > 0 || missing.length > 0 || mismatched.length > 0) process.exitCode = 1;
}

await main();
