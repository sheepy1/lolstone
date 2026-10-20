import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { lolstoneDevPlugin } from './src/dev/vitePlugin';

const root = path.dirname(fileURLToPath(import.meta.url));

// 项目根目录下的 .claude/（其他会话的 worktree）不监听，否则它们改文件会刷新这里的页面。
// 按相对项目根目录的路径判断：项目本身就在某个 worktree（路径里带 .claude）里时，自己的文件照常监听。
const insideDotClaude = (file: string) => path.relative(root, file).split(path.sep)[0] === '.claude';

// 开发时联机要用的托管平台 SDK 文件在仓库外，路径从环境变量或 .env.local（不进 git）的 LOLSTONE_SDK_FILE 读（src/dev/vitePlugin.ts）
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'LOLSTONE_');
  return {
    plugins: [react(), lolstoneDevPlugin({ sdkFile: env.LOLSTONE_SDK_FILE || process.env.LOLSTONE_SDK_FILE })],
    server: { port: 5173, strictPort: false, watch: { ignored: insideDotClaude } },
    // 动画调试台、粒子预设演示页（只在开发服务器里有）也是入口，依赖要一起预构建
    optimizeDeps: { entries: ['index.html', 'src/dev/fx/index.html', 'src/dev/particles/index.html'] },
    build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  };
});
