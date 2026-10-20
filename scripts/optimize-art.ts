// 把原图按显示尺寸缩放、转成 WebP，生成 public/art/ 的成品（spec 5.9、5.10）。
//
//   node scripts/optimize-art.ts              原图和规则都没变的成品跳过
//   node scripts/optimize-art.ts --force      全部重做
//   node scripts/optimize-art.ts --concurrency 4
//
// 输入：fetch-art.ts、fetch-icons.ts 下载到 assets-src/art/ 的原图和它们的清单（manifest.json、icons-manifest.json）。
// 输出：public/art/ 下同样的目录结构，扩展名一律 .webp：
//   art/<英雄 key 小写>/icon.webp、loading.webp
//   art/cards/<卡牌 id>/icon.webp、art.webp（art 和 icon 同一个来源时只有 icon.webp，src/assets/cardArt.ts 按同样的规则取路径）
//   art/heropowers/<职业>.webp、art/keywords/<关键词>.webp
//   art/manifest.json：每个成品的尺寸、字节数、用的质量，和原图的路径、尺寸、字节数、下载地址
// public/art/ 整个目录归本脚本管，清单里没有的文件会删掉。
//
// 为什么要缩：符文之地传说的原画 2048×1024、一张 1 到 2 MB，而卡面贴图里原画窗口只有 380×327，一局预载十几张就是 10 MB，
// 托管页在慢网络上要等几分钟。尺寸和质量规则在 scripts/lib/art-sizes.ts。要先装 ffmpeg（带 libwebp，macOS 用
// `brew install ffmpeg`）。缩放用 Lanczos，RGB 转 YUV 用全色度精度。

import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { FACE_WINDOW, OVERSAMPLE, QUALITY, RULES_VERSION, parseCrop, targetSize, type ArtCrop, type ArtRole, type Size } from './lib/art-sizes.ts';
import { ASSETS_SRC_DIR, PUBLIC_DIR, formatBytes, parseCli, readManifest, runPool, toAbs, writeManifest } from './lib/files.ts';

const OUT_MANIFEST = 'art/manifest.json';
const SRC_HERO_MANIFEST = 'art/manifest.json';
const SRC_ICONS_MANIFEST = 'art/icons-manifest.json';
/** 短边不超过这个的算小图标，用 libwebp 的 icon 预设（不做降噪和去块，边缘保持清楚）。 */
const SMALL_ICON = 128;

type SrcFile = { path: string; url: string; bytes: number } | null;

type HeroManifest = { version: string; champions: { key: string; icon: SrcFile; loading: SrcFile }[] };

type IconsManifest = {
  ddragonVersion: string;
  lorVersion: string;
  cards: Record<string, { icon: SrcFile; art: SrcFile; crop: unknown }>;
  heroPowers: Record<string, { icon: SrcFile }>;
  keywords: Record<string, { icon: SrcFile }>;
};

type Job = {
  role: ArtRole;
  /** 原图，相对 assets-src/。 */
  src: string;
  url: string;
  /** 成品，相对 public/。 */
  out: string;
  crop: ArtCrop;
  /** 没有 icon 的卡：方形头像也从这张原画裁。 */
  portraitFromArt: boolean;
};

type OutFile = {
  bytes: number;
  width: number;
  height: number;
  role: ArtRole;
  quality: number;
  source: { path: string; url: string; bytes: number; width: number; height: number };
};

type OutManifest = {
  generatedAt: string;
  /** 用的规则（scripts/lib/art-sizes.ts），变了就全部重做。 */
  rules: { version: number; faceWindow: Size; oversample: number; quality: Record<ArtRole, number> };
  ddragonVersion: string;
  lorVersion: string;
  files: Record<string, OutFile>;
  failed: { path: string; error: string }[];
};

function exec(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} 退出码 ${code}：${Buffer.concat(err).toString().trim()}`));
    });
  });
}

async function hasCommand(cmd: string): Promise<boolean> {
  try {
    await exec(cmd, ['-version']);
    return true;
  } catch {
    return false;
  }
}

type Probe = { width: number; height: number; pixFmt: string };

async function probe(file: string): Promise<Probe> {
  const out = (await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file]))
    .toString()
    .trim();
  const [w, h, pixFmt] = out.split(',');
  const width = Number(w);
  const height = Number(h);
  if (!width || !height) throw new Error(`读不到尺寸：${out}`);
  return { width, height, pixFmt: pixFmt ?? '' };
}

/** 有没有真用到透明：像素格式带 alpha（或调色板）的图，把 alpha 通道抽出来看最小值。 */
async function usesAlpha(file: string, pixFmt: string): Promise<boolean> {
  if (!/a|pal/.test(pixFmt)) return false;
  const plane = await exec('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'format=rgba,extractplanes=a', '-f', 'rawvideo', '-']);
  for (const b of plane) if (b < 255) return true;
  return false;
}

async function encode(src: string, out: string, size: Size | null, quality: number, alpha: boolean, small: boolean): Promise<void> {
  const vf = [];
  if (size) vf.push(`scale=${size.w}:${size.h}:flags=lanczos+accurate_rnd+full_chroma_int`);
  vf.push(`format=${alpha ? 'yuva420p' : 'yuv420p'}`);
  await exec('ffmpeg', [
    '-hide_banner', '-v', 'error', '-y', '-i', src,
    '-sws_flags', 'lanczos+accurate_rnd+full_chroma_int+full_chroma_inp',
    '-vf', vf.join(','),
    '-c:v', 'libwebp', '-quality', String(quality), '-preset', small ? 'icon' : 'picture', '-compression_level', '6',
    '-f', 'webp', out,
  ]);
}

const toWebp = (rel: string) => rel.replace(/\.[^./]+$/, '.webp');

function collectJobs(hero: HeroManifest, icons: IconsManifest): { jobs: Job[]; skippedMissing: string[] } {
  const jobs: Job[] = [];
  const skippedMissing: string[] = [];
  const whole = parseCrop(null);
  const push = (role: ArtRole, f: SrcFile, label: string, crop = whole, portraitFromArt = false) => {
    if (!f) {
      skippedMissing.push(label);
      return;
    }
    jobs.push({ role, src: f.path, url: f.url, out: toWebp(f.path), crop, portraitFromArt });
  };
  for (const c of hero.champions) {
    push('hero_icon', c.icon, `${c.key} icon`);
    push('hero_loading', c.loading, `${c.key} loading`);
  }
  for (const [id, c] of Object.entries(icons.cards)) {
    push('card_icon', c.icon, `${id} icon`);
    // art 和 icon 同一个文件时只做一次：按 icon 的规则（不缩），卡面原画窗口里按小图放大
    if (c.art && (!c.icon || c.art.path !== c.icon.path)) push('card_art', c.art, `${id} art`, parseCrop(c.crop), !c.icon);
    else if (!c.art) skippedMissing.push(`${id} art`);
  }
  for (const [id, hp] of Object.entries(icons.heroPowers)) push('hero_power', hp.icon, `${id}`);
  for (const [id, kw] of Object.entries(icons.keywords)) push('keyword', kw.icon, `${id}`);
  return { jobs, skippedMissing };
}

/** 成品还能不能用：上次清单记的原图路径和大小、规则版本、质量都没变，成品文件也在、大小对得上。 */
async function reusable(job: Job, prev: OutManifest | undefined, srcBytes: number): Promise<OutFile | null> {
  const old = prev?.files[job.out];
  if (!old || prev!.rules.version !== RULES_VERSION) return null;
  if (old.source.path !== job.src || old.source.bytes !== srcBytes || old.role !== job.role || old.quality !== QUALITY[job.role]) return null;
  try {
    const { size } = await stat(toAbs(job.out));
    return size === old.bytes ? old : null;
  } catch {
    return null;
  }
}

async function process(job: Job): Promise<OutFile> {
  const src = toAbs(job.src, ASSETS_SRC_DIR);
  const srcInfo = await probe(src);
  const { size: srcBytes } = await stat(src);
  const size = targetSize(job.role, srcInfo.width, srcInfo.height, job.crop, job.portraitFromArt);
  const resized = size.w !== srcInfo.width || size.h !== srcInfo.height;
  const quality = QUALITY[job.role];
  const out = toAbs(job.out);
  await mkdir(path.dirname(out), { recursive: true });
  // 先写 .part 再改名，中断不留半截文件
  const part = `${out}.part`;
  await encode(src, part, resized ? size : null, quality, await usesAlpha(src, srcInfo.pixFmt), Math.min(srcInfo.width, srcInfo.height) <= SMALL_ICON);
  await rename(part, out);
  const outInfo = await probe(out);
  const { size: bytes } = await stat(out);
  return {
    bytes,
    width: outInfo.width,
    height: outInfo.height,
    role: job.role,
    quality,
    source: { path: job.src, url: job.url, bytes: srcBytes, width: srcInfo.width, height: srcInfo.height },
  };
}

/** 删掉 public/art 下清单里没有的文件（旧格式的原图、不再用的卡），再删空目录。 */
async function removeStale(keep: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  const root = toAbs('art');
  const walk = async (dir: string): Promise<boolean> => {
    let empty = true;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(PUBLIC_DIR, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (await walk(full)) await rm(full, { recursive: true });
        else empty = false;
      } else if (rel === OUT_MANIFEST || keep.has(rel)) {
        empty = false;
      } else {
        await rm(full);
        removed.push(rel);
      }
    }
    return empty;
  };
  try {
    await walk(root);
  } catch {
    // public/art 还不存在
  }
  return removed;
}

async function main(): Promise<void> {
  const opts = parseCli();
  if (!(await hasCommand('ffmpeg')) || !(await hasCommand('ffprobe'))) {
    console.error('找不到 ffmpeg 或 ffprobe。macOS 用 `brew install ffmpeg` 安装，需要带 libwebp。');
    process.exit(1);
  }
  const hero = await readManifest<HeroManifest>(SRC_HERO_MANIFEST, ASSETS_SRC_DIR);
  const icons = await readManifest<IconsManifest>(SRC_ICONS_MANIFEST, ASSETS_SRC_DIR);
  if (!hero || !icons) {
    console.error(
      `找不到原图清单 assets-src/${SRC_HERO_MANIFEST} 或 assets-src/${SRC_ICONS_MANIFEST}，` +
        '先跑 node scripts/fetch-art.ts 和 node scripts/fetch-icons.ts',
    );
    process.exit(1);
  }
  const { jobs, skippedMissing } = collectJobs(hero, icons);
  const prev = opts.force ? undefined : await readManifest<OutManifest>(OUT_MANIFEST);
  console.log(`原图 ${jobs.length} 张（assets-src/art/），成品到 public/art/，并发 ${opts.concurrency}`);
  if (skippedMissing.length > 0) console.log(`  原图清单里下载失败的 ${skippedMissing.length} 张跳过：${skippedMissing.join('、')}`);

  const files: Record<string, OutFile> = {};
  const failed: OutManifest['failed'] = [];
  let made = 0;
  let reused = 0;
  let srcTotal = 0;
  await runPool(jobs, opts.concurrency, async (job) => {
    try {
      const { size: srcBytes } = await stat(toAbs(job.src, ASSETS_SRC_DIR));
      srcTotal += srcBytes;
      const old = await reusable(job, prev, srcBytes);
      if (old) {
        files[job.out] = old;
        reused++;
        return;
      }
      const made1 = await process(job);
      files[job.out] = made1;
      made++;
      const scaled = made1.width !== made1.source.width ? `${made1.source.width}×${made1.source.height} → ` : '';
      console.log(`  ${job.out}  ${scaled}${made1.width}×${made1.height}，${formatBytes(made1.source.bytes)} → ${formatBytes(made1.bytes)}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ path: job.src, error });
      console.error(`  失败 ${job.src}：${error}`);
    }
  });

  // 清单按输出路径排序，diff 稳定
  const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]!]));
  const manifest: OutManifest = {
    generatedAt: new Date().toISOString(),
    rules: { version: RULES_VERSION, faceWindow: { ...FACE_WINDOW }, oversample: OVERSAMPLE, quality: QUALITY },
    ddragonVersion: icons.ddragonVersion,
    lorVersion: icons.lorVersion,
    files: sorted,
    failed,
  };
  await writeManifest(OUT_MANIFEST, manifest);
  const removed = await removeStale(new Set(Object.keys(files)));

  const outTotal = Object.values(files).reduce((s, f) => s + f.bytes, 0);
  console.log(`\n成品（public/${OUT_MANIFEST}）`);
  console.log(`  新做   ${made} 张`);
  console.log(`  沿用   ${reused} 张（原图和规则都没变）`);
  console.log(`  失败   ${failed.length} 张`);
  console.log(`  合计   ${Object.keys(files).length} 张，${formatBytes(outTotal)}（原图 ${formatBytes(srcTotal)}）`);
  if (removed.length > 0) console.log(`  清理   ${removed.length} 个清单里没有的旧文件：${removed.slice(0, 8).join('、')}${removed.length > 8 ? '…' : ''}`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
