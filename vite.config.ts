import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // .claude/worktrees 下是其他会话的工作区，不监听、不扫描，否则它们改文件会刷新这里的页面
  server: { port: 5173, strictPort: false, watch: { ignored: ['**/.claude/**'] } },
  optimizeDeps: { entries: ['index.html'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
