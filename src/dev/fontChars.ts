// 卡面 SDF 字体子集要带的字：卡池里所有卡的名字和文本、职业名、界面文字，加上数字和 ASCII。
// 子集文件旁边的 .chars.txt 记着实际带了哪些字，测试用它核对卡池和界面没有用到子集外的字。
// 主菜单、加载页、结算面板（src/ui/fontFaces.css 的 @font-face）也用这个子集，缺的字会由系统宋体补，字形不统一。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CARD_POOL, HERO_CLASSES } from '../cards';

// 界面文字所在的目录：src/ui 是界面组件；src/app 里有加载页的进度说明、出错提示这类交给界面显示的字符串；
// src/presentation 和 src/scene 里有场景里的 SDF 文字（横幅、先后手、胜负大字、换牌说明）和悬停说明的关键词解释
export const UI_TEXT_DIRS = ['src/ui', 'src/app', 'src/presentation', 'src/scene'];

const ROOT = path.resolve(import.meta.dirname, '../..');

// 去掉 // 和 /* */ 注释，字符串、模板字符串和 JSX 文本原样保留。不做完整的词法分析：
// 只认引号和反引号，够区分"字符串里的 //"和真正的注释。单双引号的字符串不跨行，
// 所以 JSX 文本里的撇号最多把那一行剩下的部分当成字符串，字照样收进来。
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  // 模板字符串里 ${ 的嵌套层数：在 ${ } 里面时按代码处理（可以有注释），回到 } 时继续字符串
  const templateDepth: number[] = [];
  let braces = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '`' || (ch === '}' && templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === braces)) {
      if (ch === '}') templateDepth.pop();
      let j = i + 1;
      while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j);
      if (src[j] === '$') {
        templateDepth.push(braces);
        out += '${';
        i = j + 2;
      } else {
        out += '`';
        i = j + 1;
      }
      continue;
    }
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    out += ch;
    i++;
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(p);
  }
  return files;
}

// 这些文件里字符串和 JSX 文本用到的非 ASCII 字符（ASCII 子集里本来就全带）。注释不收，免得子集无谓变大。
function textChars(files: readonly string[]): string {
  const set = new Set<string>();
  for (const f of files) {
    for (const ch of stripComments(readFileSync(f, 'utf8'))) if (ch.codePointAt(0)! > 127 && !/\s/.test(ch)) set.add(ch);
  }
  return [...set].sort().join('');
}

// 界面代码里用到的非 ASCII 字符。
export function uiTextChars(): string {
  return textChars(UI_TEXT_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir))));
}

// 打开页面的加载页和主菜单上的字所在的文件：主菜单组件、职业介绍和难度（menuData）、
// 共用的标题和单选组、加载页、启动进度的说明、职业名。主菜单上的"联机"按钮在 MainMenu 里；点开的联机面板（OnlinePanel）
// 不收：它的字约 6.5 KB，50 KB/s 下所有人打开页面要多等 0.13 秒，而面板要点了才出来，那时其余的字通常已经下好。界面字体按 unicode-range 切成两片（src/ui/fontFaces.css）：
// 这些字单独一片，打开页面时只等这一片；其余的字在主菜单出来以后后台加载。主菜单上加了别的文件里的文字，要加进这里。
export const MENU_TEXT_FILES = [
  'src/ui/MainMenu.tsx',
  'src/ui/menuData.ts',
  'src/ui/hextech.tsx',
  'src/ui/RadioGroup.tsx',
  'src/ui/LoadingScreen.tsx',
  'src/app/main.tsx',
  'src/cards/classes.ts',
];

// 主菜单那一片要带的字：ASCII 加上 MENU_TEXT_FILES 里的字，只取完整子集里有的。
export function menuFontChars(): string {
  const full = new Set(cardFontChars());
  const set = new Set<string>();
  for (let i = 32; i < 127; i++) set.add(String.fromCharCode(i));
  for (const ch of textChars(MENU_TEXT_FILES.map((f) => path.join(ROOT, f)))) set.add(ch);
  return [...set].filter((ch) => full.has(ch)).sort().join('');
}

export function cardFontChars(): string {
  const set = new Set<string>();
  const add = (s: string) => {
    for (const ch of s) set.add(ch);
  };
  for (const c of CARD_POOL) {
    add(c.name);
    add(c.text);
  }
  for (const h of HERO_CLASSES) add(h.name);
  for (let i = 32; i < 127; i++) add(String.fromCharCode(i));
  add('，。：；、！？（）「」…·—＋－');
  add(uiTextChars());
  return [...set].sort().join('');
}
