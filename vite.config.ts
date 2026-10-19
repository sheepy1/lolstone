import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { melolDevPlugin } from './src/dev/vitePlugin';

const root = path.dirname(fileURLToPath(import.meta.url));

// 项目根目录下的 .claude/（其他会话的 worktree）不监听，否则它们改文件会刷新这里的页面。
// 按相对项目根目录的路径判断：项目本身就在某个 worktree（路径里带 .claude）里时，自己的文件照常监听。
const insideDotClaude = (file: string) => path.relative(root, file).split(path.sep)[0] === '.claude';

export default defineConfig({
  plugins: [react(), melolDevPlugin()],
  server: { port: 5173, strictPort: false, watch: { ignored: insideDotClaude } },
  // 动画调试台、粒子预设演示页（只在开发服务器里有）也是入口，依赖要一起预构建
  optimizeDeps: { entries: ['index.html', 'src/dev/fx/index.html', 'src/dev/particles/index.html'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
