// 生成音效试听页：按类别列出 public/audio/manifest.json 里的每个候选，可以点击播放，标出来源和授权。
// 页面和音频一起复制到输出目录，双击 index.html 就能用，不需要起服务。
//
//   node scripts/audio-audition.ts --out <目录>
//
// 页面上可以给每个候选打"留用"，选择存在浏览器本地；"导出选择"把留用的候选复制成 JSON，贴回给实现方改清单。
// 语音部分抽几个英雄，对比处理前（assets-src 留底的原件）和处理后。

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ASSETS_SRC } from './lib/audio.ts';
import { PUBLIC_DIR } from './lib/files.ts';

type Loud = { integrated: number; momentaryMax: number; truePeak: number };
type FileEntry = {
  ogg: string;
  mp3: string;
  duration: number;
  gainDb: number;
  peakLimited: boolean;
  limitingDb: number;
  before: Loud;
  after: Loud;
  note: string | null;
  sources: { id: string; member: string; trim: [number, number?] | null; title: string; author: string; page: string; license: string }[];
};
type Sound = {
  id: string;
  group: string;
  label: string;
  spec: string;
  profile: string;
  inSfxTable: boolean;
  loop: boolean;
  files: FileEntry[];
};
type Manifest = {
  generatedAt: string;
  profiles: Record<string, { measure: string; target: number }>;
  sounds: Sound[];
  voice: { ogg: string; mp3: string; duration: number; gainDb: number; before: Loud; after: Loud }[];
};

const GROUPS: Record<string, string> = {
  ui: '界面',
  card: '卡牌',
  spell: '法术（按 fx 类型）',
  combat: '战斗',
  hero_power: '职业英雄技能',
  flow: '流程',
  music: '音乐',
  ambience: '环境音',
};

/** 语音抽样：四个职业的英雄。 */
const VOICE_SAMPLES = ['garen', 'darius', 'ahri', 'ashe'];

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function loud(l: Loud, profile: string): string {
  const m = profile === 'sfx' ? l.momentaryMax : l.integrated;
  return `${m} LUFS`;
}

function fileRow(sound: Sound, f: FileEntry, i: number, profileTarget: string): string {
  const key = `${sound.id}#${i + 1}`;
  const srcs = f.sources
    .map((s) => {
      const trim = s.trim ? `，截取 ${s.trim[0]}–${s.trim[1] ?? '结尾'} 秒` : '';
      return `<a href="${esc(s.page)}" target="_blank" rel="noopener">${esc(s.title)}</a> · ${esc(s.author)} · ${esc(s.license)}
        <span class="member">${esc(s.member)}${trim}</span>`;
    })
    .join('<br>');
  return `<li class="cand" data-key="${esc(key)}">
    <button class="play" data-src="${esc(f.ogg)}" data-mp3="${esc(f.mp3)}" ${sound.loop ? 'data-loop="1"' : ''} aria-label="播放 ${esc(key)}">▶</button>
    <div class="info">
      <div class="head"><span class="n">${i + 1}</span><span class="dur">${f.duration.toFixed(2)} 秒</span>
        <span class="lufs" title="处理前 → 处理后（${profileTarget}）">${loud(f.before, sound.profile)} → ${loud(f.after, sound.profile)}，增益 ${f.gainDb > 0 ? '+' : ''}${f.gainDb} dB，${f.limitingDb > 0 ? `限幅压了 ${f.limitingDb} dB，` : ''}真峰值 ${f.after.truePeak} dBTP${f.peakLimited ? '，<b>峰值卡住、没到目标</b>' : ''}</span></div>
      ${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}
      <div class="src">${srcs}</div>
    </div>
    <label class="keep"><input type="checkbox" data-key="${esc(key)}"> 留用</label>
  </li>`;
}

function page(m: Manifest, voices: { key: string; kind: string; before: string; after: string; gain: number; b: Loud; a: Loud }[]): string {
  const target = (p: string) => {
    const spec = m.profiles[p];
    if (!spec) return '';
    return `${spec.measure === 'momentaryMax' ? '最大瞬时响度' : '积分响度'}目标 ${spec.target} LUFS`;
  };
  const groups = Object.keys(GROUPS)
    .map((g) => {
      const sounds = m.sounds.filter((s) => s.group === g);
      if (!sounds.length) return '';
      const items = sounds
        .map(
          (s) => `<section class="sound" id="${esc(s.id)}">
        <header><h3>${esc(s.label)}</h3><code>${esc(s.id)}</code>
          ${s.inSfxTable || s.profile !== 'sfx' ? '' : '<span class="tag">sfx.ts 里还没有这个键</span>'}
          ${s.files.length > 1 && s.profile === 'sfx' ? `<button class="rand" data-id="${esc(s.id)}">随机播一个</button>` : ''}</header>
        <p class="spec">${esc(s.spec)} · ${target(s.profile)}</p>
        <ol>${s.files.map((f, i) => fileRow(s, f, i, target(s.profile))).join('')}</ol>
      </section>`,
        )
        .join('');
      return `<h2 id="g-${g}">${GROUPS[g]}</h2>${items}`;
    })
    .join('');
  const nav = Object.entries(GROUPS)
    .map(([g, name]) => `<a href="#g-${g}">${name}</a>`)
    .join('');
  const voiceRows = voices
    .map(
      (v) => `<li class="cand"><div class="info"><div class="head"><span class="n">${esc(v.key)}</span><span>${v.kind === 'choose' ? '选用语音（登场）' : '禁用语音（死亡）'}</span>
        <span class="lufs">${v.b.integrated} → ${v.a.integrated} LUFS，增益 ${v.gain > 0 ? '+' : ''}${v.gain} dB</span></div></div>
        <button class="play small" data-src="${esc(v.before)}">处理前</button>
        <button class="play small" data-src="${esc(v.after)}">处理后</button></li>`,
    )
    .join('');
  const total = m.sounds.reduce((n, s) => n + s.files.length, 0);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MeLoL 音效试听</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#e3e1dc;--accent:#b8872b;--accent-fg:#fff;--tag:#fdecc8}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--fg:#ececee;--muted:#9a9aa2;--card:#1e2024;--line:#2e3036;--accent:#d7a645;--accent-fg:#141518;--tag:#4a3a14}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:24px;margin:0 0 4px}h2{margin:36px 0 12px;font-size:19px;border-bottom:1px solid var(--line);padding-bottom:6px}
h3{font-size:16px;margin:0}
.lead{color:var(--muted);margin:0 0 16px}
nav{position:sticky;top:0;background:var(--bg);padding:8px 0;display:flex;flex-wrap:wrap;gap:6px 14px;z-index:2;border-bottom:1px solid var(--line)}
nav a{color:var(--fg);text-decoration:none;font-size:14px}nav a:hover{color:var(--accent)}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
.sound{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
.sound header{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
code{font-size:13px;color:var(--muted)}
.tag{background:var(--tag);font-size:12px;padding:1px 6px;border-radius:4px}
.spec{color:var(--muted);font-size:13px;margin:4px 0 6px}
ol{list-style:none;margin:0;padding:0}
.cand{display:flex;gap:12px;align-items:flex-start;padding:8px 0;border-top:1px dashed var(--line)}
.cand:first-child{border-top:0}
.info{flex:1;min-width:0}
.head{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;font-size:14px}
.n{font-weight:600}.dur,.lufs{color:var(--muted);font-size:13px}
.note{font-size:13px;margin-top:2px}
.src{font-size:13px;margin-top:2px;overflow-wrap:anywhere}.src a{color:var(--accent)}
.member{color:var(--muted)}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:4px 10px}
button:hover{border-color:var(--accent)}
.play{width:40px;height:40px;border-radius:50%;flex:none;padding:0;font-size:15px}
.play.small{width:auto;height:auto;border-radius:6px;padding:4px 10px;font-size:13px}
.play.on{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.keep{font-size:13px;white-space:nowrap;color:var(--muted);align-self:center}
#out{width:100%;min-height:120px;font:12px ui-monospace,monospace;display:none;margin-top:8px;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px}
</style></head><body><div class="wrap">
<h1>MeLoL 音效试听</h1>
<p class="lead">${m.sounds.length} 个事件或类别，${total} 个候选，全部 CC0。播放的是统一响度之后的成品（ogg，浏览器不支持时用 mp3）。
每个候选标了处理前后的响度：音效按最大瞬时响度对齐，音乐、收尾、环境音和语音按积分响度对齐。
起音很尖或很短的音效，增益受峰值上限限制，会比目标轻，标了"峰值卡住"。生成于 ${esc(m.generatedAt.slice(0, 16).replace('T', ' '))}（UTC）。</p>
<nav>${nav}<a href="#g-voice">语音对比</a></nav>
<div class="bar"><button id="stop">停止播放</button><button id="export">导出选择</button><span id="count" class="lufs"></span></div>
<textarea id="out" readonly></textarea>
${groups}
<h2 id="g-voice">语音：处理前后对比（抽 ${VOICE_SAMPLES.length} 个英雄）</h2>
<section class="sound"><p class="spec">语音按积分响度对齐到 ${m.profiles.voice?.target ?? ''} LUFS。全部 ${m.voice.length} 条的范围见实现方的汇报。</p><ol>${voiceRows}</ol></section>
</div>
<script>
const KEY='melol.audition.keep';let keep={};try{keep=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const cur={a:null,b:null};
function stop(){if(cur.a){cur.a.pause();cur.a=null}if(cur.b){cur.b.classList.remove('on');cur.b=null}}
const canOgg=new Audio().canPlayType('audio/ogg; codecs="vorbis"')!=='';
function play(btn){const same=cur.b===btn;stop();if(same)return;
  const a=new Audio(canOgg||!btn.dataset.mp3?btn.dataset.src:btn.dataset.mp3);a.loop=!!btn.dataset.loop;
  a.onended=()=>{if(cur.a===a)stop()};a.play();cur.a=a;cur.b=btn;btn.classList.add('on')}
document.addEventListener('click',e=>{const b=e.target.closest('button.play');if(b)play(b);
  const r=e.target.closest('button.rand');if(r){const bs=[...document.querySelectorAll('#'+CSS.escape(r.dataset.id)+' button.play')];play(bs[Math.floor(Math.random()*bs.length)])}});
document.getElementById('stop').onclick=stop;
function count(){const n=Object.values(keep).filter(Boolean).length;document.getElementById('count').textContent=n?('已留用 '+n+' 个'):''}
document.querySelectorAll('input[type=checkbox][data-key]').forEach(c=>{c.checked=!!keep[c.dataset.key];
  c.onchange=()=>{keep[c.dataset.key]=c.checked;try{localStorage.setItem(KEY,JSON.stringify(keep))}catch(e){}count()}});count();
document.getElementById('export').onclick=()=>{const by={};for(const [k,v] of Object.entries(keep)){if(!v)continue;const [id,n]=k.split('#');(by[id]=by[id]||[]).push(Number(n))}
  const o=document.getElementById('out');o.style.display='block';o.value=JSON.stringify(by,null,1);o.select();try{navigator.clipboard.writeText(o.value)}catch(e){}};
</script></body></html>
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) {
    console.error('用法：node scripts/audio-audition.ts --out <目录>');
    process.exit(1);
  }
  const out = path.resolve(values.out);
  const m = JSON.parse(await readFile(path.join(PUBLIC_DIR, 'audio/manifest.json'), 'utf8')) as Manifest;

  let copied = 0;
  const copy = async (from: string, rel: string) => {
    await mkdir(path.dirname(path.join(out, rel)), { recursive: true });
    await copyFile(from, path.join(out, rel));
    copied++;
  };
  for (const s of m.sounds) {
    for (const f of s.files) {
      await copy(path.join(PUBLIC_DIR, f.ogg), f.ogg);
      await copy(path.join(PUBLIC_DIR, f.mp3), f.mp3);
    }
  }
  const voices = [];
  for (const key of VOICE_SAMPLES) {
    for (const kind of ['choose', 'ban']) {
      const v = m.voice.find((x) => x.ogg === `audio/voice/${key}/${kind}.ogg`);
      if (!v) continue;
      const before = `audio/voice-raw/${key}/${kind}.ogg`;
      await copy(path.join(ASSETS_SRC, 'voice', key, `${kind}.ogg`), before);
      await copy(path.join(PUBLIC_DIR, v.ogg), v.ogg);
      voices.push({ key, kind, before, after: v.ogg, gain: v.gainDb, b: v.before, a: v.after });
    }
  }
  await writeFile(path.join(out, 'index.html'), page(m, voices));
  console.log(`试听页：${path.join(out, 'index.html')}（复制了 ${copied} 个音频文件）`);
}

await main();
