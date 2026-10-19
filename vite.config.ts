import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { melolDevPlugin } from './src/dev/vitePlugin';

export default defineConfig({
  plugins: [react(), melolDevPlugin()],
  // .claude/worktrees 下是其他会话的工作区，不监听、不扫描，否则它们改文件会刷新这里的页面
  server: { port: 5173, strictPort: false, watch: { ignored: ['**/.claude/**'] } },
  // 动画调试台、粒子预设演示页（只在开发服务器里有）也是入口，依赖要一起预构建
  optimizeDeps: { entries: ['index.html', 'src/dev/fx/index.html', 'src/dev/particles/index.html'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
