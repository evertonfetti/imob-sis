import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: { '/v1': { target: 'http://localhost:3433', changeOrigin: true } },
  },
});
