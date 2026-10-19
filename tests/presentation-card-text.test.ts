// 卡面正文的断行和字号（src/scene/cardTextLayout.ts）：卡池里每张卡的正文都在文本框内，字号不低于原字号的 75%，
// 标点不在行首，"+1/+1" 这类数值不从中间断开。宽度用近似值（中文 1 em、半角 0.55 em），思源宋体的实际宽度和它很接近，
// 浏览器里用卡面字体实际量（/dev/art 对照页可以看）。
import { describe, expect, it } from 'vitest';
import { CARD_POOL } from '../src/cards';
import { approxMeasure, breakLines, layoutBody, MIN_SCALE, tokenize, type BodyBox } from '../src/scene/cardTextLayout';

// 和 src/scene/cardText.ts 的 BODY_BOX 一致（那个文件带 troika，测试环境里不导入）
const PX = 1.5 / 512;
const box = (bottom: number): BodyBox => ({ width: (464 - 48 - 12) * PX, height: (bottom - 488) * PX, fontSize: 0.088, lineHeight: 1.3 });
const BOX = { minion: box(592), spell: box(648) };

const NO_START = /^[，。、；：！？）】》」』’”…,.;:!?)\]%]/;

describe('卡面正文断行', () => {
  it('中文逐字断，半角的数值和符号整体不断', () => {
    expect(tokenize('获得 +1/+1。')).toEqual(['获', '得', ' ', '+1/+1', '。']);
  });

  it('标点不放在行首：放不下时把上一个字一起带到下一行', () => {
    // 宽 6 em：前六个字刚好一行，第七个是逗号，不能放在行首
    const lines = breakLines('造成三点伤害，然后抽牌', approxMeasure, 6);
    expect(lines).toEqual(['造成三点伤', '害，然后抽牌']);
  });

  it('行尾的空格去掉，原文的换行照样换', () => {
    expect(breakLines('一二 三四\n五', approxMeasure, 2.6)).toEqual(['一二', '三四', '五']);
  });

  const cards = CARD_POOL.filter((c) => c.text);
  for (const c of cards) {
    it(`${c.name}（${c.id}）的正文在文本框内`, () => {
      const b = BOX[c.type === 'minion' ? 'minion' : 'spell'];
      const l = layoutBody(c.text, approxMeasure, b);
      expect(l.fits, l.lines.join(' / ')).toBe(true);
      expect(l.fontSize).toBeGreaterThanOrEqual(b.fontSize * MIN_SCALE - 1e-9);
      expect(l.lines.join('').replace(/\s/g, ''), '断行不丢字').toBe(c.text.replace(/\s/g, ''));
      for (const line of l.lines) {
        expect(approxMeasure(line) * l.fontSize, line).toBeLessThanOrEqual(b.width + 1e-9);
        expect(line, `行首是标点：${l.lines.join(' / ')}`).not.toMatch(NO_START);
      }
      for (const num of c.text.match(/[!-~]+/g) ?? []) expect(l.lines.some((x) => x.includes(num)), `${num} 被断开`).toBe(true);
    });
  }

  it('最长的几张（泰达米尔、纳什男爵、乌迪尔、娑娜、特朗德尔）排成多行、缩了字号但不低于下限', () => {
    for (const id of ['freljord.tryndamere', 'neutral.baron_nashor', 'freljord.udyr', 'demacia.sona', 'freljord.trundle']) {
      const c = CARD_POOL.find((x) => x.id === id)!;
      const l = layoutBody(c.text, approxMeasure, BOX.minion);
      expect(l.lines.length, id).toBeGreaterThanOrEqual(2);
      expect(l.fits, id).toBe(true);
    }
  });
});
