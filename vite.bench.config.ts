/**
 * Kapasite ölçüm betiklerini Node üzerinde çalıştırılabilir tek dosyaya derler.
 *
 * Projede ayrı bir esbuild/tsx kurulumu olmadığı için Vite'ın SSR derlemesi
 * kullanılır: seçilen betik uygulamanın gerçek `src/lib` modülleriyle birlikte
 * `.bench/bench.mjs` dosyasına paketlenir.
 *
 * Kullanım:
 *   pnpm exec vite build --config vite.bench.config.ts
 *   node --expose-gc .bench/bench.mjs
 *
 * Başka bir betiği derlemek için `BENCH_ENTRY` değişkeni verilir:
 *   BENCH_ENTRY=scripts/bench-full-load.ts pnpm exec vite build --config vite.bench.config.ts
 */
import path from 'node:path';
import { defineConfig } from 'vite';

const root = process.cwd();
const entry = process.env.BENCH_ENTRY ?? 'scripts/bench-capacity.ts';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  build: {
    ssr: path.resolve(root, entry),
    outDir: '.bench',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: { format: 'esm', entryFileNames: 'bench.mjs' },
    },
  },
});