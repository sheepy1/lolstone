// 算一局要预载多少字节（spec 5.10）：按 src/assets/manifest.ts 的 matchManifest 列出本局两套预组用到的资源，
// 把 public/ 下对应文件的大小求和。四个职业两两对局（含同职业）都算一遍，看最大的那局够不够预算。
//
//   pnpm size:preload              全部职业组合
//   pnpm size:preload --json       机器可读
//
// 语音按 ogg 算（Howler 先试 ogg，不支持才退到旁边的 mp3）。文件缺失时算 0 并列出。
import { statSync } from 'node:fs';
import path from 'node:path';
import { matchManifest, type AssetKind } from '../src/assets/manifest';
import { HERO_CLASSES, PRESET_DECKS, installDefaultPool } from '../src/cards';
import type { HeroClass } from '../src/engine';

installDefaultPool();

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../public');
const BUDGET = 3 * 1024 * 1024;

type Row = { pair: string; total: number; byKind: Partial<Record<AssetKind, number>>; count: number; missing: string[] };

function sizeOf(url: string): number | null {
  try {
    return statSync(path.join(PUBLIC_DIR, url.replace(/^\//, ''))).size;
  } catch {
    return null;
  }
}

function measure(a: HeroClass, b: HeroClass): Row {
  const entries = matchManifest([PRESET_DECKS[a]!, PRESET_DECKS[b]!], [a, b]);
  const row: Row = { pair: `${a} vs ${b}`, total: 0, byKind: {}, count: entries.length, missing: [] };
  for (const e of entries) {
    const n = sizeOf(e.url);
    if (n === null) {
      row.missing.push(e.url);
      continue;
    }
    row.total += n;
    row.byKind[e.kind] = (row.byKind[e.kind] ?? 0) + n;
  }
  return row;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

const classes = HERO_CLASSES.map((c) => c.id);
const rows: Row[] = [];
for (const a of classes) for (const b of classes) if (a <= b) rows.push(measure(a, b));
rows.sort((x, y) => y.total - x.total);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const kinds = [...new Set(rows.flatMap((r) => Object.keys(r.byKind)))] as AssetKind[];
  console.log(`一局预载的字节数（public/ 下的文件，预算 ${mb(BUDGET)}）\n`);
  console.log(['对局', '条目', '合计', ...kinds].join('\t'));
  for (const r of rows) {
    console.log([r.pair, r.count, mb(r.total), ...kinds.map((k) => (r.byKind[k] === undefined ? '-' : kb(r.byKind[k]!)))].join('\t'));
  }
  const worst = rows[0]!;
  console.log(`\n最大的一局 ${worst.pair}：${mb(worst.total)}，${worst.total <= BUDGET ? '在预算内' : `超出预算 ${mb(worst.total - BUDGET)}`}`);
  const missing = new Set(rows.flatMap((r) => r.missing));
  if (missing.size > 0) {
    console.log(`\n缺失 ${missing.size} 个文件（按 0 算）：`);
    for (const m of [...missing].slice(0, 20)) console.log(`  ${m}`);
  }
  if (worst.total > BUDGET) process.exitCode = 1;
}
