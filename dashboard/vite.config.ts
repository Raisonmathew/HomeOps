import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The Config page imports ../worker/src/config/constants.ts so it always shows
  // the values the Worker actually uses; allow the dev server to read it.
  server: { fs: { allow: ['..'] } },
});
