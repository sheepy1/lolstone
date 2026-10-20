// 落盘、跳过判断、并发、清单读写、命令行参数和汇总输出。

import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

/** 仓库根目录下的 public/：成品，进 git，构建时原样进 dist/。 */
export const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../public');

/**
 * 仓库根目录下的 assets-src/：原始素材，不进 git（.gitignore）。fetch-art.ts、fetch-icons.ts 把原图下载到
 * assets-src/art/，scripts/optimize-art.ts 再按显示尺寸缩放、转 WebP 到 public/art/；音频的原始素材在 assets-src/audio/。
 * 下面带 root 参数的函数默认在 public/ 下，传 ASSETS_SRC_DIR 就在原始素材目录下。
 */
export const ASSETS_SRC_DIR = path.resolve(import.meta.dirname, '../../assets-src');

/** 小于这个大小的文件当作坏文件：正常头像、原画、语音都在 10 KB 以上。 */
const MIN_BYTES = 1024;

/** 文件头魔数。防止把服务器返回的 HTML 错误页当成素材存下来。 */
const MAGIC: Record<string, number[]> = {
  '.png': [0x89, 0x50, 0x4e, 0x47],
  '.jpg': [0xff, 0xd8, 0xff],
  '.ogg': [0x4f, 0x67, 0x67, 0x53], // "OggS"
  '.webp': [0x52, 0x49, 0x46, 0x46], // "RIFF"
};

function hasMagic(file: string, head: Uint8Array): boolean {
  const magic = MAGIC[path.extname(file)];
  return !magic || magic.every((b, i) => head[i] === b);
}

/** 清单里记的路径相对 root（默认 public/，也就是网页里的 URL 路径；原图相对 assets-src/）。 */
export function toAbs(publicPath: string, root = PUBLIC_DIR): string {
  return path.join(root, publicPath);
}

/**
 * 已下载的文件能不能直接用：存在、不小于 MIN_BYTES、文件头对、大小和上次清单记的一致。
 * 上次清单没有这条记录（比如清单被删了）时不跳过，重下一遍。
 */
export async function isUsable(publicPath: string, recordedBytes: number | undefined, root = PUBLIC_DIR): Promise<boolean> {
  if (recordedBytes === undefined) return false;
  const abs = toAbs(publicPath, root);
  try {
    const { size } = await stat(abs);
    if (size < MIN_BYTES || size !== recordedBytes) return false;
    const fh = await open(abs, 'r');
    try {
      const head = new Uint8Array(4);
      await fh.read(head, 0, 4, 0);
      return hasMagic(abs, head);
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

/** 先写 .part 再改名，下载中断不会留下半截文件。 */
export async function saveFile(publicPath: string, data: Uint8Array, root = PUBLIC_DIR): Promise<void> {
  if (data.byteLength < MIN_BYTES) throw new Error(`文件太小（${data.byteLength} B）`);
  if (!hasMagic(publicPath, data)) throw new Error('文件头不对，可能是错误页');
  const abs = toAbs(publicPath, root);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(`${abs}.part`, data);
  await rename(`${abs}.part`, abs);
}

/** 最多 limit 个任务同时跑，结果顺序和输入一致。 */
export async function runPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function readManifest<T>(publicPath: string, root = PUBLIC_DIR): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(toAbs(publicPath, root), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function writeManifest(publicPath: string, data: unknown, root = PUBLIC_DIR): Promise<void> {
  const abs = toAbs(publicPath, root);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${JSON.stringify(data, null, 2)}\n`);
}

export type CliOptions = { force: boolean; concurrency: number };

export function parseCli(): CliOptions {
  const { values } = parseArgs({
    options: {
      force: { type: 'boolean', default: false },
      concurrency: { type: 'string', default: '5' },
    },
  });
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    console.error('--concurrency 要是 1 到 6 的整数');
    process.exit(1);
  }
  return { force: values.force, concurrency };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export type Tally = { downloaded: number; downloadedBytes: number; skipped: number; totalBytes: number };

export function newTally(): Tally {
  return { downloaded: 0, downloadedBytes: 0, skipped: 0, totalBytes: 0 };
}

export function printTally(label: string, t: Tally, failed: number): void {
  console.log(`\n${label}`);
  console.log(`  新下载 ${t.downloaded} 个，${formatBytes(t.downloadedBytes)}`);
  console.log(`  跳过   ${t.skipped} 个（已存在且完整）`);
  console.log(`  失败   ${failed} 个`);
  console.log(`  本地合计 ${t.downloaded + t.skipped} 个，${formatBytes(t.totalBytes)}`);
}
