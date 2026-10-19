// 卡面正文的断行和字号（spec 5.4）。troika-three-text 只在空白处折行，中文整句没有空白，原来长文本会排成一整行溢出卡外。
// 这里自己断行，再把换行符写进文本交给 troika：
// - 中文逐字可断；连续的英文、数字、符号（"+1/+1"、"-2/-2"）算一个整体，不从中间断；空格处可断，行首行尾的空格去掉。
// - 避头尾：逗号、句号、冒号、右括号等不放在行首，左括号、左引号不放在行尾；碰到时把上一行最后一个字一起带到下一行。
// - 行数放不下文本框时逐级缩小字号，最小到原字号的 MIN_SCALE；还放不下就按最小字号排（卡池里没有这种卡，测试会报）。
// 不依赖 DOM：宽度由调用方传入的 measure 给出（浏览器里用 canvas 按卡面字体量，测试里用近似值）。

/** 量一段文字的宽度，单位是 em（字号为 1 时的宽度）。 */
export type Measure = (s: string) => number;

export type BodyBox = {
  /** 文本框宽度（卡牌本地坐标）。 */
  width: number;
  /** 从正文第一行顶边到能放字的最低处的高度。 */
  height: number;
  /** 原字号。 */
  fontSize: number;
  /** 行高（字号的倍数）。 */
  lineHeight: number;
};

export type BodyLayout = { lines: string[]; fontSize: number; fits: boolean };

export const MIN_SCALE = 0.75;
const SCALES = [1, 0.93, 0.87, 0.81, MIN_SCALE];

// 不能出现在行首的标点（中文和英文的收尾标点）
const NO_LINE_START = new Set([...'，。、；：！？）】》」』’”…,.;:!?)]%']);
// 不能出现在行尾的标点
const NO_LINE_END = new Set([...'（【《「『‘“([']);

/** 拆成断行的最小单位：中文一个字一个单位，连续的半角非空白字符一个单位，空格单独一个单位。 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let run = '';
  for (const ch of text) {
    if (/[!-~]/.test(ch)) {
      run += ch;
      continue;
    }
    if (run) out.push(run);
    run = '';
    out.push(ch);
  }
  if (run) out.push(run);
  return out;
}

const isSpace = (t: string) => /^\s+$/.test(t);

/** 按宽度 maxEm（em）贪心断行，遵守避头尾。原文里的换行符照样换行。 */
export function breakLines(text: string, measure: Measure, maxEm: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line: string[] = [];
    const width = (ts: string[]) => measure(ts.join(''));
    const push = (ts: string[]) => {
      while (ts.length && isSpace(ts[ts.length - 1]!)) ts.pop();
      lines.push(ts.join(''));
    };
    for (const tok of tokenize(para)) {
      if (line.length === 0 && isSpace(tok)) continue;
      if (line.length === 0 || width([...line, tok]) <= maxEm || isSpace(tok)) {
        line.push(tok);
        continue;
      }
      // 放不下，要换行。tok 不能在行首、或者上一行末尾是不能在行尾的字时，把上一行最后一个单位一起带下去
      const carry: string[] = [];
      if (line.length > 1 && (NO_LINE_START.has(tok[0]!) || NO_LINE_END.has(line[line.length - 1]!))) carry.unshift(line.pop()!);
      // 带下去之后上一行又以左括号收尾（"（甲"），把左括号也带下去
      if (line.length > 1 && NO_LINE_END.has(line[line.length - 1]!)) carry.unshift(line.pop()!);
      push(line);
      line = [...carry, tok];
    }
    if (line.length) push(line);
  }
  return lines;
}

/** 正文在文本框里的断行和字号：从原字号开始逐级缩小，取第一个行数放得下的。 */
export function layoutBody(text: string, measure: Measure, box: BodyBox): BodyLayout {
  if (!text) return { lines: [], fontSize: box.fontSize, fits: true };
  let last: BodyLayout | null = null;
  for (const k of SCALES) {
    const fontSize = box.fontSize * k;
    const lines = breakLines(text, measure, box.width / fontSize);
    const fits = lines.length * fontSize * box.lineHeight <= box.height + 1e-9;
    last = { lines, fontSize, fits };
    if (fits) return last;
  }
  return last!;
}

/** 近似的宽度：半角字符 0.55 em，其余 1 em。浏览器里卡面字体还没加载好时、以及测试里用。 */
export const approxMeasure: Measure = (s) => {
  let w = 0;
  for (const ch of s) w += /[ -~]/.test(ch) ? 0.55 : 1;
  return w;
};
