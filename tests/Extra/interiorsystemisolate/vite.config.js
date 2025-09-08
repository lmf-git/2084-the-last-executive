import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [svelte(), wasm()],
  server: {
    port: 5173
  },
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat']
  }
});