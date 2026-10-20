// 卡面 SDF 字体子集：卡池和界面用到的字都要在子集里，否则卡面上会缺字、菜单里会混进系统字体。
// 缺字时运行 pnpm font:subset 重新生成。
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_POOL } from '../src/cards';
import { menuFontChars, stripComments, uiTextChars } from '../src/dev/fontChars';

const dir = path.join(import.meta.dirname, '../public/fonts');

describe('卡面字体子集', () => {
  it('存在，而且不大', () => {
    const f = path.join(dir, 'lolstone-serif-sc.woff');
    expect(existsSync(f)).toBe(true);
    expect(statSync(f).size).toBeLessThan(2_500_000);
  });

  it('卡池里所有卡的名字和文本都在子集里', () => {
    const chars = new Set(readFileSync(path.join(dir, 'lolstone-serif-sc.chars.txt'), 'utf8'));
    const missing = new Set<string>();
    for (const c of CARD_POOL) for (const ch of c.name + c.text) if (!chars.has(ch)) missing.add(ch);
    expect([...missing].join(''), '子集里缺这些字，运行 pnpm font:subset 重新生成').toBe('');
  });

  it('界面文字（主菜单、加载页、结算面板、对局界面）用到的字都在子集里', () => {
    const chars = new Set(readFileSync(path.join(dir, 'lolstone-serif-sc.chars.txt'), 'utf8'));
    const ui = uiTextChars();
    expect(ui.length).toBeGreaterThan(100); // 确实扫到了界面文字
    const missing = [...ui].filter((ch) => !chars.has(ch));
    expect(missing.join(''), '子集里缺这些字，运行 pnpm font:subset 重新生成').toBe('');
  });

  it('主菜单那一片界面字体和现在主菜单上的字对得上', () => {
    // 不一致时：多出来的字在主菜单上会先用系统字体、等完整子集下完再换过来；少了的字白占主菜单要等的字节
    const generated = readFileSync(path.join(dir, 'lolstone-serif-sc-menu.chars.txt'), 'utf8');
    expect(generated, '主菜单上的字变了，运行 pnpm font:subset 重新生成').toBe(menuFontChars());
    expect(existsSync(path.join(dir, 'lolstone-serif-sc-menu.woff2'))).toBe(true);
    expect(existsSync(path.join(dir, 'lolstone-serif-sc.woff2'))).toBe(true);
    // 第一条 @font-face（主菜单那一片）的 unicode-range 正好是这些字
    const css = readFileSync(path.join(import.meta.dirname, '../src/ui/fontFaces.css'), 'utf8');
    const points = new Set<number>();
    for (const part of css.match(/unicode-range: ([^;]+);/)![1]!.split(', ')) {
      const [a, b = a] = part.slice(2).split('-').map((h) => parseInt(h, 16));
      for (let p = a!; p <= b!; p++) points.add(p);
    }
    expect([...points].sort((x, y) => x - y)).toEqual([...generated].map((ch) => ch.codePointAt(0)!).sort((x, y) => x - y));
  });

  it('收界面文字时不收注释', () => {
    const src = "const a = '甲//乙'; // 丙\nconst t = `丁${ {b: 1}.b /* 戊 */ }己//庚`; /* 辛 */\n<div>{/* 壬 */}癸</div>";
    const kept = [...stripComments(src)].filter((ch) => ch.codePointAt(0)! > 127).join('');
    expect(kept).toBe('甲乙丁己庚癸');
  });
});
