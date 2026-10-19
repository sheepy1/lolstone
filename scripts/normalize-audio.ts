// 音效、音乐、语音统一响度和格式（spec 5.7、5.9），输出 ogg 加 mp3 兜底（老版本 Safari 不支持 ogg）。
//
//   node scripts/normalize-audio.ts                  只处理输入或参数变了的文件
//   node scripts/normalize-audio.ts --force          全部重做
//   node scripts/normalize-audio.ts --only sfx,voice 只处理某几类：sfx、music、voice
//
// 输入和输出：
// - 音效和音乐：按 scripts/data/audio-sources.json 的候选，从 assets-src/audio/sources/（fetch-sfx.ts 下载的）读原始
//   素材，输出 public/audio/sfx/<id>/<n>.ogg|mp3、public/audio/music/<id>/<n>.ogg|mp3，n 是候选的序号（从 1 起）。
// - 语音：fetch-voice.ts 拉到 public/audio/voice/<key>/{choose,ban}.ogg。第一次处理时把原件复制到
//   assets-src/audio/voice/ 留底，处理结果写回原路径，旁边加一个 .mp3。以后重跑都从留底的原件处理，不会反复有损转码。
//   重新跑过 fetch-voice.ts 之后，public 里又是原件，本脚本按内容认出来，重新留底再处理。
// - public/audio/manifest.json：每个事件或类别 → 候选文件 → 来源、授权、处理前后的响度。
//
// 响度目标见 PROFILES。短音效的积分响度不可靠（短于 400 毫秒算不出来，几百毫秒的也偏低），所以音效按最大瞬时响度
// （400 毫秒窗口）对齐；语音、音乐、环境音按积分响度对齐。增益是整段统一的静态增益，不做动态压缩。
// 增益有上限：限幅器最多压 maxLimitingDb。几十毫秒的点击声、起音很尖的撞击和碎裂声，要达到目标峰值得高出上限十几 dB，
// 硬压会把起音压扁、听着发闷发破，所以这类音效停在"峰值上限 + maxLimitingDb"，比目标轻，汇总里单独列出（"受峰值限制"）。
// 受限音效的最终响度只取决于 maxLimitingDb，和目标无关；目标定得越高，受限的和不受限的差得越多。音效目标定 -18 而不是
// 更高，就是为了让撞击、碎裂这类重要的声音不比"增益"这类柔和的声音轻太多（音效表的 volume 最大是 1，补不回来）。
// 短促的声音本来就听着比长的轻，剩下的差别保留；同类之间要再调轻重，用 src/audio/sfx.ts 音效表的 volume。

import { availableParallelism, tmpdir } from 'node:os';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { Candidate, Input, Loudness, Profile, SoundEntry, Source } from './lib/audio.ts';
import {
  ASSETS_SRC, REPO_DIR, candidateInputs, hasCommand, inputPath, loadSources, measure, probeDuration, run, sha256,
  sha256File,
} from './lib/audio.ts';
import { PUBLIC_DIR, runPool } from './lib/files.ts';

type ProfileSpec = {
  /** 对齐用哪个指标。 */
  measure: 'momentaryMax' | 'integrated';
  /** 目标响度（LUFS）。 */
  target: number;
  channels: 1 | 2;
  /** 高通滤波截止频率（Hz），去掉低频隆隆声和直流偏移。 */
  highpass: number;
  /** 去掉开头和结尾的静音，让音效按下就响。 */
  trimSilence: boolean;
  /** 限幅器最多压掉的峰值（dB），增益到此为止。撞击类音效压 6 dB 听不出来，语音和音乐压多了会听出失真。 */
  maxLimitingDb: number;
  /** libvorbis 质量（0 到 10）和 libmp3lame VBR 质量（0 最好，9 最差）。 */
  vorbisQ: number;
  mp3Q: number;
};

/**
 * 各类的响度目标。对局音乐的最大瞬时响度一般在 -16 左右，音乐通道默认音量又是 0.5（约 -6 dB），比音效低 4 dB 上下，不盖过音效；
 * 环境音要很轻（spec 5.7）。同一类之间的轻重差别（比如悬停比按钮轻）由 src/audio/sfx.ts 音效表的 volume 表达，
 * 素材本身都对齐到同一目标。
 */
export const PROFILES: Record<Profile, ProfileSpec> = {
  sfx: { measure: 'momentaryMax', target: -18, channels: 1, highpass: 40, trimSilence: true, maxLimitingDb: 6, vorbisQ: 4, mp3Q: 4 },
  voice: { measure: 'integrated', target: -18, channels: 1, highpass: 60, trimSilence: false, maxLimitingDb: 3, vorbisQ: 4, mp3Q: 4 },
  stinger: { measure: 'integrated', target: -18, channels: 2, highpass: 30, trimSilence: false, maxLimitingDb: 3, vorbisQ: 5, mp3Q: 3 },
  music: { measure: 'integrated', target: -20, channels: 2, highpass: 30, trimSilence: false, maxLimitingDb: 3, vorbisQ: 5, mp3Q: 3 },
  ambience: { measure: 'integrated', target: -30, channels: 2, highpass: 30, trimSilence: false, maxLimitingDb: 3, vorbisQ: 4, mp3Q: 4 },
};

export const SAMPLE_RATE = 48_000;
/** 限幅器的采样峰值上限（dBFS）。比真峰值上限 -1 dBTP 再低 1.5 dB，留给有损编码的过冲（实测 vorbis 会冒出 1 dB 左右）。 */
const LIMIT_DBFS = -2.5;
const TRUE_PEAK_MAX = -1;
/** 增益超过这个值说明素材本身很轻，放大后底噪也跟着上来，汇总里提醒。 */
const BIG_GAIN_DB = 18;
/** 处理链的版本。改了处理链（滤波、编码参数以外的逻辑）就加一，让旧输出全部重做。 */
const CHAIN_VERSION = 4;

const STATE_FILE = path.join(PUBLIC_DIR, 'audio/.normalize-state.json');
const MANIFEST_FILE = path.join(PUBLIC_DIR, 'audio/manifest.json');
const VOICE_DIR = path.join(PUBLIC_DIR, 'audio/voice');
const VOICE_RAW_DIR = path.join(ASSETS_SRC, 'voice');

type Result = {
  /** 相对 public/ 的路径，也就是网页里的 URL 路径。 */
  ogg: string;
  mp3: string;
  duration: number;
  gainDb: number;
  /** 增益被峰值上限卡住，没达到响度目标。 */
  peakLimited: boolean;
  /** 限幅器压掉的峰值（dB）。压得越多，响度比"增益 + 处理前响度"低得越多，短音效尤其明显。 */
  limitingDb: number;
  before: Loudness;
  after: Loudness;
};

type StateEntry = Result & { key: string; outSha?: string };
type State = Record<string, StateEntry>;

const round1 = (n: number) => Math.round(n * 10) / 10;

function metric(l: Loudness, p: Profile): number {
  return PROFILES[p].measure === 'momentaryMax' ? l.momentaryMax : l.integrated;
}

/** 单路输入的截取和淡入淡出。中间截出来的片段两头默认各淡 20 毫秒，避免爆音。 */
function trimFilters(input: Input): string[] {
  if (!input.trim) return [];
  const [start, end] = input.trim;
  const f = [`atrim=start=${start}${end !== undefined ? `:end=${end}` : ''}`, 'asetpts=PTS-STARTPTS'];
  if (start > 0) f.push('afade=t=in:d=0.02');
  const fade = input.fadeOut ?? 0.02;
  if (end !== undefined) f.push(`afade=t=out:st=${Math.max(0, end - start - fade)}:d=${fade}`);
  return f;
}

/** 结尾 crossfade 秒叠回开头，做成无缝循环：out(t) = seg(t)·淡入 + seg(L+t)·淡出，t < crossfade。 */
function loopFilters(inLabel: string, outLabel: string, length: number, crossfade: number): string {
  const L = length;
  const F = crossfade;
  return (
    `[${inLabel}]atrim=0:${L + F},asetpts=PTS-STARTPTS,asplit[lb][lt];` +
    `[lb]atrim=0:${L},afade=t=in:d=${F}[lm];` +
    `[lt]atrim=${L}:${L + F},asetpts=PTS-STARTPTS,afade=t=out:d=${F}[lx];` +
    `[lm][lx]amix=inputs=2:duration=first:normalize=0[${outLabel}]`
  );
}

/** 第一步：截取、混音、循环、重采样、声道、高通、去静音，输出 32 位浮点 WAV，再测响度。 */
async function prepare(inputs: string[], cand: Candidate | null, profile: Profile, out: string): Promise<void> {
  const spec = PROFILES[profile];
  const ins = cand ? candidateInputs(cand) : [];
  const parts: string[] = [];
  const common = `aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  inputs.forEach((_, i) => {
    const input = ins[i];
    const f = [...(input ? trimFilters(input) : []), common];
    if (input?.gainDb) f.push(`volume=${input.gainDb}dB`);
    parts.push(`[${i}:a]${f.join(',')}[i${i}]`);
  });
  let label = 'i0';
  if (inputs.length > 1) {
    parts.push(`${inputs.map((_, i) => `[i${i}]`).join('')}amix=inputs=${inputs.length}:duration=longest:normalize=0[mx]`);
    label = 'mx';
  }
  const loop = cand && 'mix' in cand ? cand.loop : undefined;
  if (loop) {
    parts.push(loopFilters(label, 'lp', loop.length, loop.crossfade));
    label = 'lp';
  }
  const tail = [
    `aformat=sample_fmts=flt:channel_layouts=${spec.channels === 1 ? 'mono' : 'stereo'}`,
    `highpass=f=${spec.highpass}`,
  ];
  if (spec.trimSilence) {
    const s = 'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.005';
    tail.push(s, 'areverse', s, 'areverse');
  }
  parts.push(`[${label}]${tail.join(',')}[out]`);
  await run('ffmpeg', [
    '-hide_banner', '-v', 'error', '-y',
    ...inputs.flatMap((f) => ['-i', f]),
    '-filter_complex', parts.join(';'),
    '-map', '[out]', '-c:a', 'pcm_f32le', out,
  ]);
}

/**
 * 第二步：整段乘同一个增益，限幅，编码成 ogg 和 mp3。限幅器只看采样点，采样点之间的峰值（真峰值）会漏掉，
 * 所以先升到 4 倍采样率再限幅。
 */
async function encode(wav: string, gainDb: number, profile: Profile, ogg: string, mp3: string): Promise<void> {
  const spec = PROFILES[profile];
  const limit = (10 ** (LIMIT_DBFS / 20)).toFixed(4);
  const af =
    `volume=${gainDb}dB,aresample=${SAMPLE_RATE * 4},` +
    `alimiter=limit=${limit}:level=false:latency=true:attack=5:release=50,aresample=${SAMPLE_RATE}`;
  const common = ['-hide_banner', '-v', 'error', '-y', '-i', wav, '-af', af, '-ar', String(SAMPLE_RATE), '-map_metadata', '-1'];
  await run('ffmpeg', [...common, '-c:a', 'libvorbis', '-q:a', String(spec.vorbisQ), ogg]);
  await run('ffmpeg', [...common, '-c:a', 'libmp3lame', '-q:a', String(spec.mp3Q), mp3]);
}

type Job = {
  /** 状态文件里的键，也是输出路径去掉扩展名（相对 public/）。 */
  base: string;
  profile: Profile;
  inputs: string[];
  candidate: Candidate | null;
  /** 输入文件内容和处理参数的摘要，没变就跳过。 */
  key: string;
  /** 语音：处理完把 ogg 写回 pub。fresh 表示 pub 是新拉的原件，不是上次的输出，必须处理。 */
  voice?: { pub: string; fresh: boolean };
};

async function processJob(job: Job, tmp: string): Promise<Result> {
  const wav = path.join(tmp, `${sha256(job.base).slice(0, 16)}.wav`);
  await prepare(job.inputs, job.candidate, job.profile, wav);
  const before = await measure(wav);
  const wanted = PROFILES[job.profile].target - metric(before, job.profile);
  const cap = LIMIT_DBFS - before.truePeak + PROFILES[job.profile].maxLimitingDb;
  const gainDb = round1(Math.min(wanted, cap));
  const ogg = path.join(PUBLIC_DIR, `${job.base}.ogg`);
  const mp3 = path.join(PUBLIC_DIR, `${job.base}.mp3`);
  await mkdir(path.dirname(ogg), { recursive: true });
  // 先写临时文件再改名，处理中断不会留下半截文件（语音的 ogg 就是原路径，更要这样）
  await encode(wav, gainDb, job.profile, `${ogg}.tmp.ogg`, `${mp3}.tmp.mp3`);
  await rename(`${ogg}.tmp.ogg`, ogg);
  await rename(`${mp3}.tmp.mp3`, mp3);
  await rm(wav, { force: true });
  const after = await measure(ogg);
  return {
    ogg: path.relative(PUBLIC_DIR, ogg),
    mp3: path.relative(PUBLIC_DIR, mp3),
    duration: await probeDuration(ogg),
    gainDb,
    peakLimited: wanted > cap,
    limitingDb: round1(Math.max(0, gainDb - (LIMIT_DBFS - before.truePeak))),
    before,
    after,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const shaCache = new Map<string, Promise<string>>();
function cachedSha(file: string): Promise<string> {
  let p = shaCache.get(file);
  if (!p) {
    p = sha256File(file);
    shaCache.set(file, p);
  }
  return p;
}

function outDir(profile: Profile): 'sfx' | 'music' {
  return profile === 'sfx' ? 'sfx' : 'music';
}

async function soundJobs(sounds: SoundEntry[], sources: Record<string, Source>, missing: string[]): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const s of sounds) {
    for (const [i, cand] of s.candidates.entries()) {
      const base = `audio/${outDir(s.profile)}/${s.id}/${i + 1}`;
      const inputs = candidateInputs(cand).map((input) => inputPath(sources, input));
      const absent = [];
      for (const f of inputs) if (!(await exists(f))) absent.push(path.relative(REPO_DIR, f));
      if (absent.length) {
        missing.push(`${base}：缺 ${absent.join('、')}（先跑 fetch-sfx.ts）`);
        continue;
      }
      const shas = await Promise.all(inputs.map(cachedSha));
      const key = sha256(JSON.stringify([CHAIN_VERSION, PROFILES[s.profile], SAMPLE_RATE, LIMIT_DBFS, cand, shas]));
      jobs.push({ base, profile: s.profile, inputs, candidate: cand, key });
    }
  }
  return jobs;
}

/** 语音：public 里的文件是本脚本上次的输出就从留底的原件处理，否则它是新拉的原件，先留底。 */
async function voiceJobs(state: State): Promise<Job[]> {
  const jobs: Job[] = [];
  const keys = await readdir(VOICE_DIR).catch(() => [] as string[]);
  for (const k of keys.sort()) {
    for (const kind of ['choose', 'ban']) {
      const pub = path.join(VOICE_DIR, k, `${kind}.ogg`);
      if (!(await exists(pub))) continue;
      const base = `audio/voice/${k}/${kind}`;
      const raw = path.join(VOICE_RAW_DIR, k, `${kind}.ogg`);
      const pubSha = await sha256File(pub);
      const prev = state[base];
      const fresh = !prev || prev.outSha !== pubSha;
      if (fresh) {
        await mkdir(path.dirname(raw), { recursive: true });
        await copyFile(pub, raw);
      } else if (!(await exists(raw))) {
        console.warn(`  ${base}：已处理过但留底的原件不见了，跳过（重跑 fetch-voice.ts 拿原件）`);
        continue;
      }
      const key = sha256(JSON.stringify([CHAIN_VERSION, PROFILES.voice, SAMPLE_RATE, LIMIT_DBFS, await sha256File(raw)]));
      jobs.push({ base, profile: 'voice', inputs: [raw], candidate: null, key, voice: { pub, fresh } });
    }
  }
  return jobs;
}

type Range = { min: number; max: number };
function range(xs: number[]): Range | null {
  return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null;
}
const fmt = (r: Range | null, unit: string) => (r ? `${r.min} 到 ${r.max} ${unit}` : '无');

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      force: { type: 'boolean', default: false },
      only: { type: 'string', default: 'sfx,music,voice' },
      concurrency: { type: 'string', default: String(Math.max(2, Math.floor(availableParallelism() / 2))) },
    },
  });
  const only = new Set(values.only.split(','));
  const concurrency = Number(values.concurrency);

  if (!(await hasCommand('ffmpeg')) || !(await hasCommand('ffprobe'))) {
    console.error('找不到 ffmpeg 或 ffprobe。macOS 用 `brew install ffmpeg` 安装，需要带 libvorbis 和 libmp3lame。');
    process.exit(1);
  }

  const data = await loadSources();
  let state: State = {};
  try {
    state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    // 第一次跑
  }

  const missing: string[] = [];
  const sounds = data.sounds.filter((s) => only.has(outDir(s.profile)));
  const jobs = [...(await soundJobs(sounds, data.sources, missing)), ...(only.has('voice') ? await voiceJobs(state) : [])];

  const tmp = await mkdtemp(path.join(tmpdir(), 'melol-audio-'));
  let done = 0;
  let skipped = 0;
  const failed: { base: string; error: string }[] = [];
  console.log(`待处理 ${jobs.length} 个文件，并发 ${concurrency}`);

  await runPool(jobs, concurrency, async (job) => {
    const prev = state[job.base];
    const outputs = [path.join(PUBLIC_DIR, `${job.base}.ogg`), path.join(PUBLIC_DIR, `${job.base}.mp3`)];
    if (!values.force && !job.voice?.fresh && prev?.key === job.key && (await exists(outputs[0]!)) && (await exists(outputs[1]!))) {
      skipped++;
      return;
    }
    try {
      const result = await processJob(job, tmp);
      state[job.base] = { ...result, key: job.key, outSha: job.voice ? await sha256File(job.voice.pub) : undefined };
      done++;
      if (done % 25 === 0) console.log(`  已处理 ${done} 个`);
    } catch (err) {
      failed.push({ base: job.base, error: err instanceof Error ? err.message : String(err) });
      console.error(`  失败 ${job.base}：${failed.at(-1)!.error}`);
    }
  });
  await rm(tmp, { recursive: true, force: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 1)}\n`);

  // 清单：事件或类别 → 候选文件 → 来源和授权、处理前后的响度。没处理成功的候选不进清单。
  const manifest = {
    generatedAt: new Date().toISOString(),
    sampleRate: SAMPLE_RATE,
    truePeakMax: TRUE_PEAK_MAX,
    profiles: PROFILES,
    sounds: data.sounds.map((s) => ({
      id: s.id,
      group: s.group,
      label: s.label,
      spec: s.spec,
      profile: s.profile,
      inSfxTable: s.inSfxTable ?? s.profile === 'sfx',
      loop: s.loop ?? false,
      files: s.candidates.flatMap((c, i) => {
        const st = state[`audio/${outDir(s.profile)}/${s.id}/${i + 1}`];
        if (!st) return [];
        const { key: _key, outSha: _outSha, ...result } = st;
        return [{
          ...result,
          note: c.note ?? null,
          sources: candidateInputs(c).map((input) => {
            const src = data.sources[input.source]!;
            return {
              id: input.source, member: input.member, trim: input.trim ?? null,
              title: src.title, author: src.author, page: src.page, license: src.license,
            };
          }),
        }];
      }),
    })),
    voice: Object.entries(state)
      .filter(([k]) => k.startsWith('audio/voice/'))
      .map(([, v]) => ({ ogg: v.ogg, mp3: v.mp3, duration: v.duration, gainDb: v.gainDb, before: v.before, after: v.after })),
  };
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);

  // 汇总：每类处理前后对齐指标的范围、真峰值、没达到目标的文件
  console.log(`\n统一响度（目标见 scripts/normalize-audio.ts 的 PROFILES，清单 public/audio/manifest.json）`);
  console.log(`  处理 ${done} 个，跳过 ${skipped} 个（输入和参数都没变），失败 ${failed.length} 个，缺素材 ${missing.length} 个`);
  const all = Object.entries(state).map(([base, v]) => ({ base, ...v }));
  for (const profile of Object.keys(PROFILES) as Profile[]) {
    const spec = PROFILES[profile];
    const rows = all.filter((r) => {
      if (profile === 'voice') return r.base.startsWith('audio/voice/');
      const sound = data.sounds.find((s) => r.base.startsWith(`audio/${outDir(s.profile)}/${s.id}/`));
      return sound?.profile === profile;
    });
    if (!rows.length) continue;
    const name = spec.measure === 'momentaryMax' ? '最大瞬时响度' : '积分响度';
    console.log(`\n  ${profile}（${rows.length} 个，按${name}对齐到 ${spec.target} LUFS）`);
    console.log(`    处理前 ${fmt(range(rows.map((r) => metric(r.before, profile))), 'LUFS')}`);
    console.log(`    处理后 ${fmt(range(rows.map((r) => metric(r.after, profile))), 'LUFS')}`);
    console.log(`    处理后真峰值 ${fmt(range(rows.map((r) => r.after.truePeak)), 'dBTP')}`);
    const squeezed = rows.filter((r) => (r.limitingDb ?? 0) >= 0.5);
    const limited = rows.filter((r) => r.peakLimited);
    if (squeezed.length) {
      const below = squeezed.map((r) => round1(spec.target - metric(r.after, profile)));
      console.log(
        `    限幅器压过峰值的 ${squeezed.length} 个（压 0.5 到 ${spec.maxLimitingDb} dB，短音效压峰值时响度也跟着降），` +
          `其中增益被上限卡住的 ${limited.length} 个；这些比目标轻 ${fmt(range(below), 'LU')}，逐个见清单的 limitingDb、peakLimited`,
      );
    }
    const off = rows.filter((r) => (r.limitingDb ?? 0) < 0.5 && Math.abs(metric(r.after, profile) - spec.target) > 1.5);
    for (const r of off) {
      console.log(`    - ${r.base} 处理后 ${metric(r.after, profile)} LUFS，离目标超过 1.5 LU`);
    }
    for (const r of rows.filter((x) => x.gainDb > BIG_GAIN_DB)) {
      console.log(`    - ${r.base} 放大了 ${r.gainDb} dB，原素材很轻，听一下底噪`);
    }
    for (const r of rows.filter((x) => x.after.truePeak > TRUE_PEAK_MAX)) {
      console.log(`    - ${r.base} 真峰值 ${r.after.truePeak} dBTP，超过 ${TRUE_PEAK_MAX}`);
    }
  }
  for (const m of missing) console.log(`  缺素材 ${m}`);
  for (const f of failed) console.log(`  失败 ${f.base}：${f.error}`);
  if (failed.length > 0 || missing.length > 0) process.exitCode = 1;
}

await main();
