// 只在开发服务器里生效的 Vite 插件（apply: 'serve'，不进生产构建）：
// - /dev/fx 打开动画调试台（src/dev/fx/index.html）；/dev/art 是卡牌配图总览（src/dev/art/index.html）；
// - POST /__dev/screenshot?name=xxx 把页面传来的 PNG（data URL）存到 .dev-output/xxx.png，自动化验证截原尺寸画面用。
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export function melolDevPlugin(): Plugin {
  return {
    name: 'melol-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === '/dev/fx' || url.startsWith('/dev/fx/') || url.startsWith('/dev/fx?')) {
          req.url = `/src/dev/fx/index.html${url.includes('?') ? url.slice(url.indexOf('?')) : ''}`;
          return next();
        }
        if (url === '/dev/art' || url.startsWith('/dev/art?')) {
          req.url = `/src/dev/art/index.html${url.includes('?') ? url.slice(url.indexOf('?')) : ''}`;
          return next();
        }
        if (url.startsWith('/__dev/screenshot') && req.method === 'POST') {
          const name = (new URL(url, 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w.-]/g, '_');
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            const data = Buffer.concat(chunks).toString('utf8').replace(/^data:image\/png;base64,/, '');
            const dir = path.join(server.config.root, '.dev-output');
            mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${name}.png`);
            writeFileSync(file, Buffer.from(data, 'base64'));
            res.end(file);
          });
          return;
        }
        next();
      });
    },
  };
}
