// 卡面 SDF 字体子集：卡池和界面用到的字都要在子集里，否则卡面上会缺字、菜单里会混进系统字体。
// 缺字时运行 pnpm font:subset 重新生成。
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_POOL } from '../src/cards';
import { stripComments, uiTextChars } from '../src/dev/fontChars';

const dir = path.join(import.meta.dirname, '../public/fonts');

describe('卡面字体子集', () => {
  it('存在，而且不大', () => {
    const f = path.join(dir, 'melol-serif-sc.woff');
    expect(existsSync(f)).toBe(true);
    expect(statSync(f).size).toBeLessThan(2_500_000);
  });

  it('卡池里所有卡的名字和文本都在子集里', () => {
    const chars = new Set(readFileSync(path.join(dir, 'melol-serif-sc.chars.txt'), 'utf8'));
    const missing = new Set<string>();
    for (const c of CARD_POOL) for (const ch of c.name + c.text) if (!chars.has(ch)) missing.add(ch);
    expect([...missing].join(''), '子集里缺这些字，运行 pnpm font:subset 重新生成').toBe('');
  });

  it('界面文字（主菜单、加载页、结算面板、对局界面）用到的字都在子集里', () => {
    const chars = new Set(readFileSync(path.join(dir, 'melol-serif-sc.chars.txt'), 'utf8'));
    const ui = uiTextChars();
    expect(ui.length).toBeGreaterThan(100); // 确实扫到了界面文字
    const missing = [...ui].filter((ch) => !chars.has(ch));
    expect(missing.join(''), '子集里缺这些字，运行 pnpm font:subset 重新生成').toBe('');
  });

  it('收界面文字时不收注释', () => {
    const src = "const a = '甲//乙'; // 丙\nconst t = `丁${ {b: 1}.b /* 戊 */ }己//庚`; /* 辛 */\n<div>{/* 壬 */}癸</div>";
    const kept = [...stripComments(src)].filter((ch) => ch.codePointAt(0)! > 127).join('');
    expect(kept).toBe('甲乙丁己庚癸');
  });
});
