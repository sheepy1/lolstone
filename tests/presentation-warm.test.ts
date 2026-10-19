// 预热的登记表（src/presentation/fx/warm.ts）：对局里第一次用到某个特效时不能现编译着色器。
// 自己写着色器的文件都要登记它在哪里预热；粒子预设全部要在彩排里发一次。新加特效漏了预热，这里会失败。
// 预热本身要 WebGL，在浏览器里用 src/dev/longFrames.ts 打一整局核对（对局中途新建的程序数应该是 0），见 NOTES.md。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_NAMES } from '../src/presentation/fx/particles/presets';

// warm.ts 引了场景模块（要 DOM），这里直接读源码里的登记表，不 import 它
const WARM_SRC = readFileSync('src/presentation/fx/warm.ts', 'utf8');
const coverage = [...WARM_SRC.matchAll(/^  '(src\/[^']+)': /gm)].map((m) => m[1]);

// 自己写着色器的写法
const SHADER = /new THREE\.(Raw)?ShaderMaterial\(|onBeforeCompile|fresnelMaterial\(|createParticleMaterial\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p.split(path.sep).join('/'));
  }
  return out;
}

describe('预热的登记表', () => {
  it('自己写着色器的文件都登记了在哪里预热', () => {
    const files = walk('src').filter((f) => !f.startsWith('src/dev/') && f !== 'src/presentation/fx/warm.ts' && SHADER.test(readFileSync(f, 'utf8')));
    const missing = files.filter((f) => !coverage.includes(f));
    expect(missing, `这些文件有自己的着色器，但没登记在 warm.ts 的 WARM_COVERAGE 里（第一次用到会卡一帧）`).toEqual([]);
  });

  it('登记表里没有已经不写着色器的旧文件', () => {
    const stale = coverage.filter((f) => !SHADER.test(readFileSync(f, 'utf8')));
    expect(stale).toEqual([]);
  });

  it('彩排发全部粒子预设（WARM_PARTICLES 就是 PRESET_NAMES）', () => {
    expect(WARM_SRC).toMatch(/export const WARM_PARTICLES: readonly string\[\] = PRESET_NAMES;/);
    expect(WARM_SRC).toMatch(/for \(const name of PRESET_NAMES\)/);
    expect(PRESET_NAMES.length).toBeGreaterThan(10);
  });

  it('登记成 rehearsal:xxx 的项在 REHEARSAL 里真的有', () => {
    const items = [...WARM_SRC.matchAll(/rehearsal:(\w+)/g)].map((m) => m[1]);
    for (const it of items) expect(WARM_SRC).toMatch(new RegExp(`^  ${it}: \\(r\\)`, 'm'));
  });
});
