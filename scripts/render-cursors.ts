// 把 public/cursors/*.svg 渲染成 1 倍（32×32）和 2 倍（64×64）的透明 PNG：<名>.png、<名>@2x.png。
// 光标用 PNG 而不用 SVG：Chrome 按 1 倍光栅化 SVG 光标，Retina 屏上发糊；PNG 配 image-set 两套才清晰。
//
//   node scripts/render-cursors.ts
//
// 用无头 Chromium 渲染（CDP 截透明底的图）。默认找 Playwright 缓存里的 chrome-headless-shell，
// 找不到时用环境变量 CHROME 指定浏览器可执行文件。

import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../public/cursors');
const SIZE = 32;

function findChrome(): string {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith('chromium_headless_shell')).sort().reverse()) {
      const root = path.join(cache, d);
      for (const sub of readdirSync(root)) {
        const bin = path.join(root, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  }
  throw new Error('找不到无头 Chromium，用环境变量 CHROME 指定');
}

const port = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(findChrome(), [`--remote-debugging-port=${port}`, '--headless', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

async function pageSocket(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('无头 Chromium 没有启动');
}

const ws = new WebSocket(await pageSocket());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 0;
const pending = new Map<number, (v: Record<string, unknown>) => void>();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown> };
  if (msg.id !== undefined) pending.get(msg.id)?.(msg.result ?? {});
});
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
try {
  for (const file of (await readdir(DIR)).filter((f) => f.endsWith('.svg')).sort()) {
    const svg = await readFile(path.join(DIR, file), 'utf8');
    const html = `<html><body style="margin:0;background:transparent">${svg.replace(/<!--[\s\S]*?-->/g, '')}</body></html>`;
    for (const scale of [1, 2]) {
      await send('Emulation.setDeviceMetricsOverride', { width: SIZE, height: SIZE, deviceScaleFactor: scale, mobile: false });
      await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
      await new Promise((r) => setTimeout(r, 150));
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: SIZE, height: SIZE, scale: 1 } });
      const out = file.replace(/\.svg$/, scale === 1 ? '.png' : '@2x.png');
      await writeFile(path.join(DIR, out), Buffer.from(String(shot.data), 'base64'));
      console.log(out);
    }
  }
} finally {
  ws.close();
  chrome.kill();
}
