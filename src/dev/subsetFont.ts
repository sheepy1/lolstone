// 生成卡面 SDF 字体子集：pnpm font:subset <思源宋体粗体 NotoSerifSC-Bold.otf 的路径>
// 需要 Python 的 fonttools（pip install fonttools）。不带 OpenType 排版特性：思源的标点挤压（chws 等）
// 会让 troika 把冒号挤没，中文横排也用不到它们。输出 public/fonts/melol-serif-sc.woff 和同名 .chars.txt。
// 卡池加了新字后重新运行；tests/presentation-font.test.ts 会在缺字时失败。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cardFontChars } from './fontChars';

const src = process.argv[2];
if (!src) {
  console.error('用法：pnpm font:subset <NotoSerifSC-Bold.otf>');
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'public/fonts/melol-serif-sc.woff');
const chars = cardFontChars();
const tmp = mkdtempSync(path.join(tmpdir(), 'melol-font-'));
const textFile = path.join(tmp, 'chars.txt');
writeFileSync(textFile, chars);
execFileSync(
  'python3',
  ['-m', 'fontTools.subset', src, `--text-file=${textFile}`, `--output-file=${out}`, '--flavor=woff', '--layout-features=', '--no-hinting', '--desubroutinize'],
  { stdio: 'inherit' },
);
writeFileSync(out.replace(/\.woff$/, '.chars.txt'), chars);
console.log(`写出 ${out}，${[...chars].length} 个字`);
