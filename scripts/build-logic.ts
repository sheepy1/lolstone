// 把逻辑模块（src/logic/index.ts）打成一个不带任何依赖的 ES 文件 dist-logic/logic.js，交给托管平台（docs/online.md 5.1）。
//
//   pnpm build:logic
//
// 平台的隔离环境只有 ES 内置对象加注入的 structuredClone，构建时会拒绝引用了 Node 或 Web 全局对象的模块，
// 文件上限 2 MB。所以打完在本地先查一遍：文件大小，以及源码里不能出现的全局名字，查到就失败，不等平台拒。
// tests/logic-isolate.test.ts 也调这里的 buildLogic，在 node:vm 的隔离上下文里加载打出来的文件打完一局。
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
export const LOGIC_ENTRY = path.join(ROOT, 'src/logic/index.ts');
export const LOGIC_OUTFILE = path.join(ROOT, 'dist-logic/logic.js');
const MAX_BYTES = 2 * 1024 * 1024;

// 隔离环境里没有、打包结果里不能出现的全局名字。Math.random 也没有：随机数只能来自局面里的种子
const FORBIDDEN = ['process', 'window', 'document', 'globalThis.fetch', 'fetch', 'setTimeout', 'setInterval', 'Date', 'console', 'Math.random', 'require', 'crypto'];

export type LogicBuild = { file: string; bytes: number };

export async function buildLogic(outfile = LOGIC_OUTFILE): Promise<LogicBuild> {
  await build({
    entryPoints: [LOGIC_ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    // neutral：不按 Node 或浏览器补任何东西，也不认 Node 的内置模块，引用到就打包失败
    platform: 'neutral',
    target: 'es2022',
    // src/engine/invariants.ts 用 typeof process 判断要不要开不变量检查；隔离环境里没有 process，直接换成 undefined，
    // 打出来的文件里就不再有这个名字
    define: { process: 'undefined' },
    minifySyntax: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const source = readFileSync(outfile, 'utf8');
  const found = FORBIDDEN.filter((name) => new RegExp(`(?<![\\w$.])${name.replace('.', '\\.')}(?![\\w$])`).test(source));
  if (found.length > 0) throw new Error(`logic bundle references globals the isolate does not have: ${found.join(', ')}`);
  const bytes = statSync(outfile).size;
  if (bytes > MAX_BYTES) throw new Error(`logic bundle is ${bytes} bytes, over the 2 MB limit`);
  return { file: outfile, bytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { file, bytes } = await buildLogic();
  console.log(`${path.relative(ROOT, file)}  ${(bytes / 1024).toFixed(1)} KB`);
}
