import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { melolDevPlugin } from './src/dev/vitePlugin';

export default defineConfig({
  plugins: [react(), melolDevPlugin()],
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
