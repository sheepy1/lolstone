// 生成卡面 SDF 字体子集：pnpm font:subset <思源宋体粗体 NotoSerifSC-Bold.otf 的路径>
// 需要 Python 的 fonttools 和 brotli（pip install fonttools brotli，写 woff2 要用 brotli）。不带 OpenType 排版特性：
// 思源的标点挤压（chws 等）会让 troika 把冒号挤没，中文横排也用不到它们。
// 写出（都在 public/fonts 下）：
// - lolstone-serif-sc.woff：完整子集，给 troika 生成卡面 SDF（troika 只认 woff，不认 woff2）。
// - lolstone-serif-sc.woff2：同一份完整子集，给界面的 @font-face，比 woff 小一成。
// - lolstone-serif-sc-menu.woff2：只含打开页面的加载页和主菜单上的字（fontChars.ts 的 menuFontChars），慢网络上
//   主菜单只等这一小片，不等完整的。
// - 同名 .chars.txt 记着各自带了哪些字；src/ui/fontFaces.css 是按两片的字生成的 @font-face（unicode-range）。
// 卡池或界面加了新字后重新运行；tests/presentation-font.test.ts 会在缺字、或主菜单的字和生成时对不上时失败。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cardFontChars, menuFontChars } from './fontChars';

const src = process.argv[2];
if (!src) {
  console.error('用法：pnpm font:subset <NotoSerifSC-Bold.otf>');
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, '../..');
const fonts = path.join(root, 'public/fonts');
const tmp = mkdtempSync(path.join(tmpdir(), 'lolstone-font-'));

function subset(chars: string, name: string, flavors: readonly string[]): void {
  const textFile = path.join(tmp, `${name}.txt`);
  writeFileSync(textFile, chars);
  for (const flavor of flavors) {
    execFileSync(
      'python3',
      ['-m', 'fontTools.subset', src!, `--text-file=${textFile}`, `--output-file=${path.join(fonts, `${name}.${flavor}`)}`, `--flavor=${flavor}`, '--layout-features=', '--no-hinting', '--desubroutinize'],
      { stdio: 'inherit' },
    );
  }
  writeFileSync(path.join(fonts, `${name}.chars.txt`), chars);
}

// 码位列表写成 unicode-range：连续的合成一段
function unicodeRange(points: readonly number[]): string {
  const parts: string[] = [];
  const hex = (n: number) => n.toString(16).toUpperCase();
  for (let i = 0; i < points.length; ) {
    let j = i;
    while (j + 1 < points.length && points[j + 1] === points[j]! + 1) j++;
    parts.push(i === j ? `U+${hex(points[i]!)}` : `U+${hex(points[i]!)}-${hex(points[j]!)}`);
    i = j + 1;
  }
  return parts.join(', ');
}

const full = cardFontChars();
const menu = menuFontChars();
subset(full, 'lolstone-serif-sc', ['woff', 'woff2']);
subset(menu, 'lolstone-serif-sc-menu', ['woff2']);

const menuPoints = [...menu].map((ch) => ch.codePointAt(0)!).sort((a, b) => a - b);
const menuSet = new Set(menuPoints);
const rest: number[] = [];
for (let p = 0; p <= 0x10ffff; p++) if (!menuSet.has(p)) rest.push(p);
const css = `/* 由 pnpm font:subset（src/dev/subsetFont.ts）生成，不要手改。
   界面字体按 unicode-range 切成不重叠的两片，浏览器只下载页面上实际出现的字所在的那片：
   - 打开页面的加载页和主菜单上的字：lolstone-serif-sc-menu.woff2，index.html 里 preload，主菜单只等它。
   - 其余的字：完整子集 lolstone-serif-sc.woff2（不支持 woff2 时用 woff），主菜单出来后后台加载（src/app/main.tsx）。
   两片的字形出自同一个源字体，同样的参数，拼在一起和只用完整子集一样。 */

@font-face {
  font-family: 'LoLstone Serif SC';
  src:
    url('/fonts/lolstone-serif-sc-menu.woff2') format('woff2'),
    url('/fonts/lolstone-serif-sc.woff') format('woff');
  font-weight: 700 900;
  font-display: swap;
  unicode-range: ${unicodeRange(menuPoints)};
}

@font-face {
  font-family: 'LoLstone Serif SC';
  src:
    url('/fonts/lolstone-serif-sc.woff2') format('woff2'),
    url('/fonts/lolstone-serif-sc.woff') format('woff');
  font-weight: 700 900;
  font-display: swap;
  unicode-range: ${unicodeRange(rest)};
}
`;
writeFileSync(path.join(root, 'src/ui/fontFaces.css'), css);
console.log(`写出 ${fonts} 下的完整子集（woff、woff2，${[...full].length} 个字）和主菜单子集（woff2，${[...menu].length} 个字），以及 src/ui/fontFaces.css`);
