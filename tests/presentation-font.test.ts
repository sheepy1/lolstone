// 卡面 SDF 字体子集：卡池用到的字都要在子集里，否则卡面上会缺字。缺字时运行 pnpm font:subset 重新生成。
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_POOL } from '../src/cards';

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
});
