// 音效和音乐素材的来源清单（scripts/data/audio-sources.json）、目录约定和 ffmpeg 调用。
// fetch-sfx.ts、normalize-audio.ts、audio-audition.ts 共用。

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const REPO_DIR = path.resolve(import.meta.dirname, '../..');
export const SOURCES_JSON = path.join(REPO_DIR, 'scripts/data/audio-sources.json');
/** 原始素材，不进 git 也不进构建（spec 5.9）。 */
export const ASSETS_SRC = path.join(REPO_DIR, 'assets-src/audio');
/** 每个来源下载、解压后的目录：assets-src/audio/sources/<来源 id>/。 */
export const SOURCES_DIR = path.join(ASSETS_SRC, 'sources');
/** normalize-audio.ts --candidates 的输出根目录，结构和 public/ 一样，给试听页用。 */
export const CANDIDATES_DIR = path.join(ASSETS_SRC, 'candidates');

/** 一个来源：一个素材包或单个文件，对应来源网站上的一个页面。 */
export type Source = {
  title: string;
  author: string;
  /** 来源页面，授权以页面上写的为准。 */
  page: string;
  /** SPDX 标识。只收 CC0-1.0。 */
  license: 'CC0-1.0';
  /** 页面或包里哪里写明了授权，下载前核对过。 */
  licenseEvidence: string;
  /** 包里自带的授权文件（相对解压目录），没有时省略。 */
  licenseFile?: string;
  url: string;
  /** 下载后保存的文件名。 */
  file: string;
  /** 解压方式。单个音频文件省略。 */
  archive?: 'zip' | '7z';
  /** 只下载文件开头这么多字节（HTTP Range）。用于很长的 WAV 录音，只取前一两分钟。 */
  maxBytes?: number;
  /** 下载到的字节数和 sha256，用于判断已下载的文件是否完整、上游是否换了文件。 */
  bytes?: number;
  sha256?: string;
};

/** 一路输入：来源 id 加包内路径。单个音频文件的来源，member 就是 file。 */
export type Input = {
  source: string;
  member: string;
  /** 截取 [起点, 终点] 秒。终点省略表示到结尾。 */
  trim?: [number, number?];
  /** 截取终点前淡出的秒数，默认 0.02。把长曲子截成短收尾时用。 */
  fadeOut?: number;
  /** 混音时这一路的增益（dB）。 */
  gainDb?: number;
};

/** 一个候选文件：单路输入，或者多路混成一路（环境音）。 */
export type Candidate = Input | { mix: Input[]; loop?: LoopSpec; note?: string };

/** 做成无缝循环：取 length 秒，结尾 crossfade 秒叠回开头。 */
export type LoopSpec = { length: number; crossfade: number };

export type Profile = 'sfx' | 'voice' | 'music' | 'stinger' | 'ambience';

export type Group = 'ui' | 'card' | 'spell' | 'combat' | 'hero_power' | 'flow' | 'music' | 'ambience';

export type SoundEntry = {
  /** 和 src/audio/sfx.ts 的 SfxId、music.ts 的 TrackId 对应。sfx.ts 还没有的键 inSfxTable 为 false。 */
  id: string;
  group: Group;
  label: string;
  /** spec 5.6 的事件或 5.7 的分类。 */
  spec: string;
  profile: Profile;
  inSfxTable?: boolean;
  loop?: boolean;
  /** 选定的候选，序号从 1 起，和试听页一致。成品只做这一个。 */
  selected: number;
  candidates: (Candidate & { note?: string })[];
};

export type SourcesFile = {
  checkedAt: string;
  sources: Record<string, Source>;
  sounds: SoundEntry[];
};

export async function loadSources(): Promise<SourcesFile> {
  return JSON.parse(await readFile(SOURCES_JSON, 'utf8')) as SourcesFile;
}

export function candidateInputs(c: Candidate): Input[] {
  return 'mix' in c ? c.mix : [c];
}

/** 一个条目要用到的候选：只要成品时是选中的那个，要试听时是全部。 */
export function usedCandidates(s: SoundEntry, all: boolean): Candidate[] {
  if (all) return s.candidates;
  const c = s.candidates[s.selected - 1];
  return c ? [c] : [];
}

/** 来源里某个文件在本地的路径：单文件来源就是下载的文件，压缩包来源在解压目录里。 */
export function inputPath(sources: Record<string, Source>, input: Input): string {
  const src = sources[input.source];
  if (!src) throw new Error(`来源 ${input.source} 不在 sources 里`);
  const dir = path.join(SOURCES_DIR, input.source);
  return src.archive ? path.join(dir, 'x', input.member) : path.join(dir, src.file);
}

export async function sha256File(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 跑一个命令，返回 stdout。退出码非 0 时带上 stderr 末尾抛错。 */
export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${cmd} 退出码 ${code}：${Buffer.concat(err).toString('utf8').trim().slice(-600)}`));
    });
  });
}

export async function hasCommand(cmd: string): Promise<boolean> {
  try {
    await run(cmd, ['-version']);
    return true;
  } catch {
    return false;
  }
}

/** 响度测量结果。 */
export type Loudness = {
  /** 积分响度（LUFS），整段的平均响度。短于 0.4 秒或全是静音时为 -70。 */
  integrated: number;
  /** 最大瞬时响度（LUFS，400 毫秒窗口），短音效用它对齐。 */
  momentaryMax: number;
  /** 真峰值（dBTP）。 */
  truePeak: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 用 ffmpeg 的 ebur128 测响度。末尾补 0.5 秒静音，让短于 400 毫秒的音效也能算出瞬时响度；
 * 补的静音低于门限，不影响积分响度。
 */
export async function measure(file: string): Promise<Loudness> {
  const out = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-v', 'error', '-i', file,
    '-af', 'apad=pad_dur=0.5,ebur128=peak=true:metadata=1,ametadata=mode=print:file=-',
    '-f', 'null', '-',
  ]);
  let momentaryMax = -Infinity;
  let integrated = -70;
  let peak = 0;
  for (const line of out.split('\n')) {
    const [k, s] = line.split('=');
    const v = Number(s);
    // 补的静音段上 ebur128 会给出 nan，跳过
    if (!Number.isFinite(v)) continue;
    if (k === 'lavfi.r128.M') momentaryMax = Math.max(momentaryMax, v);
    else if (k === 'lavfi.r128.I') integrated = v;
    else if (k === 'lavfi.r128.true_peak') peak = Math.max(peak, v);
  }
  return {
    integrated: round1(integrated),
    momentaryMax: round1(Number.isFinite(momentaryMax) ? momentaryMax : -70),
    truePeak: round1(peak > 0 ? 20 * Math.log10(peak) : -120),
  };
}

/** 文件时长（秒），用 ffprobe 取。 */
export async function probeDuration(file: string): Promise<number> {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Math.round(Number(out.trim()) * 100) / 100;
}
