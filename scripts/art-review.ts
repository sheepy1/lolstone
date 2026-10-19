// 生成配图对照页：每张卡显示卡名、卡面原画窗口的裁切预览、方图、选图理由和备选。给人逐张过目用。
//
//   node scripts/art-review.ts <输出的 html 路径>
//
// 先跑 fetch-icons.ts。主选图读本地 public/art/ 下的文件（页面里写相对路径，输出位置变了也能打开）；
// 备选图直接引用远程地址，不下载。

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateQueue, loadCardArtMap, resolveSource } from './lib/art-sources.ts';
import type { Alt, ArtSource, Crop } from './lib/art-sources.ts';
import { PUBLIC_DIR, readManifest } from './lib/files.ts';

type ManifestFile = { path: string; bytes: number } | null;
type Manifest = {
  ddragonVersion: string;
  lorVersion: string;
  cards: Record<string, { icon: ManifestFile; art: ManifestFile }>;
  heroPowers: Record<string, { icon: ManifestFile }>;
  keywords: Record<string, { icon: ManifestFile }>;
};

const SOURCE_LABEL: Record<ArtSource['type'], string> = {
  'ddragon-spell': 'DDragon 技能图标',
  'ddragon-passive': 'DDragon 被动图标',
  'ddragon-item': 'DDragon 物品图标',
  'ddragon-splash': 'DDragon 皮肤原画',
  cdragon: 'CDragon 游戏文件',
  lor: '符文之地传说原画',
};

const GROUPS: { title: string; prefix: string }[] = [
  { title: '中立：小兵、野怪、亚龙', prefix: 'neutral.' },
  { title: '德玛西亚法术', prefix: 'demacia.' },
  { title: '诺克萨斯法术', prefix: 'noxus.' },
  { title: '艾欧尼亚法术', prefix: 'ionia.' },
  { title: '弗雷尔卓德法术', prefix: 'freljord.' },
  { title: '衍生物', prefix: 'token.' },
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function describe(src: ArtSource): string {
  switch (src.type) {
    case 'ddragon-spell':
      return src.key;
    case 'ddragon-passive':
      return src.file;
    case 'ddragon-item':
      return `物品 ${src.id}`;
    case 'ddragon-splash':
      return `${src.champion}_${src.skin}`;
    case 'cdragon':
      return path.basename(src.path);
    case 'lor':
      return src.code;
  }
}

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) {
    console.error('用法：node scripts/art-review.ts <输出的 html 路径>');
    process.exit(1);
  }
  const outPath = path.resolve(out);
  const map = await loadCardArtMap();
  const manifest = await readManifest<Manifest>('art/icons-manifest.json');
  if (!manifest) {
    console.error('找不到 public/art/icons-manifest.json，先跑 node scripts/fetch-icons.ts');
    process.exit(1);
  }
  const local = (f: ManifestFile) =>
    f ? path.relative(path.dirname(outPath), path.join(PUBLIC_DIR, f.path)).split(path.sep).join('/') : null;
  const remote = (src: ArtSource) => resolveSource(src, manifest.ddragonVersion, map.lorVersion).url;

  const img = (src: string | null, cls: string, style = '') =>
    src ? `<img class="${cls}" src="${esc(src)}" style="${style}" loading="lazy" alt="">` : `<div class="${cls} none">无</div>`;

  const cropStyle = (crop: Crop) => {
    if (typeof crop === 'string') return '';
    const pos = `${crop.focus[0] * 100}% ${crop.focus[1] * 100}%`;
    return `object-position:${pos};transform-origin:${pos};transform:scale(${crop.zoom ?? 1})`;
  };
  const cropText = (crop: Crop) =>
    typeof crop === 'string'
      ? crop
      : `焦点 ${crop.focus.join(', ')}${crop.zoom ? `，放大 ${crop.zoom} 倍` : ''}${crop.note ? `（${crop.note}）` : ''}`;

  const alts = (list: Alt[]) =>
    list.length === 0
      ? ''
      : `<div class="alts">${list
          .map(
            (a) =>
              `<figure>${img(remote(a), a.type === 'ddragon-splash' || a.type === 'lor' ? 'alt wide' : 'alt')}` +
              `<figcaption>${esc(a.note)}<br><span class="src">${esc(SOURCE_LABEL[a.type])} · ${esc(describe(a))}</span></figcaption></figure>`,
          )
          .join('')}</div>`;

  const cardHtml = (id: string) => {
    const c = map.cards[id]!;
    const m = manifest.cards[id];
    const lowRes = c.art.type === 'cdragon' || (c.art.type.startsWith('ddragon-') && c.art.type !== 'ddragon-splash');
    const tags = [
      `<span class="tag">${esc(SOURCE_LABEL[c.art.type])}</span>`,
      lowRes ? '<span class="tag warn">小图放大</span>' : '',
      c.generate ? `<span class="tag gen">以后生成大图 #${c.generatePriority ?? '-'}</span>` : '',
    ].join('');
    return `<article class="card" id="${esc(id)}">
  <header><h3>${esc(c.name)}</h3><code>${esc(id)}</code></header>
  <div class="row">
    <div class="window">${img(local(m?.art ?? null), 'art', cropStyle(c.art.crop))}</div>
    <div class="side">${img(local(m?.icon ?? null), 'icon')}<div class="label">方图</div></div>
  </div>
  <div class="tags">${tags}</div>
  <p class="reason">${esc(c.reason)}</p>
  <p class="meta">原画：${esc(describe(c.art))}；裁切：${esc(cropText(c.art.crop))}${c.icon ? `；方图：${esc(describe(c.icon))}` : '；方图：无，从原画裁'}</p>
  ${c.generate ? `<p class="gen-req">生成要求：${esc(c.generate)}</p>` : ''}
  ${alts(c.alts)}
</article>`;
  };

  const iconHtml = (id: string, e: { name: string; icon: ArtSource; reason: string; alts: Alt[] }, file: ManifestFile) =>
    `<article class="card small" id="${esc(id)}">
  <header><h3>${esc(e.name)}</h3><code>${esc(id)}</code></header>
  <div class="row">${img(local(file), 'icon big')}<p class="reason">${esc(e.reason)}<br><span class="src">${esc(SOURCE_LABEL[e.icon.type])} · ${esc(describe(e.icon))}</span></p></div>
  ${alts(e.alts)}
</article>`;

  const ids = Object.keys(map.cards);
  const sections = GROUPS.map(
    (g) =>
      `<section><h2>${esc(g.title)}</h2><div class="grid">${ids
        .filter((id) => id.startsWith(g.prefix))
        .map(cardHtml)
        .join('')}</div></section>`,
  ).join('\n');
  const heroPowers = Object.entries(map.heroPowers)
    .map(([id, e]) => iconHtml(id, e, manifest.heroPowers[id]?.icon ?? null))
    .join('');
  const keywords = Object.entries(map.keywords)
    .map(([id, e]) => iconHtml(id, e, manifest.keywords[id]?.icon ?? null))
    .join('');
  const generate = generateQueue(map);

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MeLoL 卡牌配图对照</title>
<style>
  :root { --bg:#14161b; --panel:#1d2027; --line:#2e333d; --text:#e8e4da; --muted:#9a9488; --gold:#c8aa6e; --warn:#e0a040; --gen:#d06a8a; }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 16px 64px; background:var(--bg); color:var(--text); font:14px/1.55 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { margin:0 0 4px; font-size:22px; } h2 { margin:32px 0 12px; font-size:17px; color:var(--gold); border-bottom:1px solid var(--line); padding-bottom:6px; }
  .intro { color:var(--muted); max-width:960px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(330px, 1fr)); gap:14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; }
  .card header { display:flex; align-items:baseline; gap:8px; margin-bottom:8px; }
  .card h3 { margin:0; font-size:16px; } code { color:var(--muted); font-size:12px; }
  .row { display:flex; gap:10px; align-items:flex-start; }
  .window { width:220px; aspect-ratio:1/0.86; border:3px solid var(--gold); border-radius:10px; overflow:hidden; background:#000; flex:none; }
  .art { width:100%; height:100%; object-fit:cover; display:block; }
  .side { text-align:center; }
  .icon { width:72px; height:72px; object-fit:cover; border:2px solid var(--line); border-radius:6px; display:block; }
  .icon.big { width:96px; height:96px; flex:none; }
  .none { display:flex; align-items:center; justify-content:center; color:var(--muted); background:#0c0d10; }
  .label { color:var(--muted); font-size:12px; margin-top:4px; }
  .tags { margin:8px 0 4px; display:flex; gap:6px; flex-wrap:wrap; }
  .tag { font-size:12px; padding:1px 7px; border-radius:10px; background:#2a2f39; color:var(--muted); }
  .tag.warn { background:#3d2f17; color:var(--warn); } .tag.gen { background:#3d1c28; color:var(--gen); }
  .reason { margin:4px 0; } .meta, .src { color:var(--muted); font-size:12px; } .gen-req { color:var(--gen); font-size:13px; margin:4px 0; }
  .alts { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; padding-top:8px; border-top:1px dashed var(--line); }
  .alts figure { margin:0; width:96px; font-size:11px; color:var(--muted); }
  .alt { width:64px; height:64px; object-fit:cover; border-radius:4px; display:block; }
  .alt.wide { width:96px; height:56px; }
  .small .reason { font-size:13px; }
  ol.gen { color:var(--gen); }
</style></head><body>
<h1>MeLoL 卡牌配图对照</h1>
<p class="intro">没有英雄原画的 ${ids.length} 张卡、4 个英雄技能、${Object.keys(map.keywords).length} 个关键词。金框是卡面原画窗口（宽高比 1 : 0.86，和现在 canvasArt.ts 的卡面一致）按映射表的焦点裁切的效果；右边的方图给场上随从头像和小图标用。虚线下面是备选，直接引用远程地址。
映射表：scripts/data/card-art.json。Data Dragon ${esc(manifest.ddragonVersion)}，符文之地传说 ${esc(manifest.lorVersion)}。</p>
<p class="intro">以后要生成大图的卡，按先后排（现在先用替代图）：</p>
<ol class="gen">${generate.map(([id, c]) => `<li>${esc(c.name)}（${esc(id)}）：${esc(c.generate!)}</li>`).join('')}</ol>
${sections}
<section><h2>英雄技能</h2><div class="grid">${heroPowers}</div></section>
<section><h2>关键词</h2><div class="grid">${keywords}</div></section>
</body></html>
`;
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html);
  console.log(`对照页：${outPath}`);
}

await main();
