import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import fs from 'node:fs';
import path from 'path';
import { viteSourceLocator } from '@metagptx/vite-plugin-source-locator';
import { atoms } from '@metagptx/web-sdk/plugins';
import { vitePrerenderPlugin } from 'vite-prerender-plugin';
import Sitemap from 'vite-plugin-sitemap';
import { getBlogRoutes } from './prerender/blog-routes.js';
import { getSitemapLastmod } from './prerender/blog-sitemap.js';

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

process.env.VITE_APP_TITLE ??= process.env.OVERVIEW_TITLE ?? 'shadcnui';
process.env.VITE_APP_DESCRIPTION ??= process.env.OVERVIEW_DESCRIPTION ?? 'Atoms Generated Project';
process.env.VITE_APP_TITLE = escapeHtmlAttr(process.env.VITE_APP_TITLE);
process.env.VITE_APP_DESCRIPTION = escapeHtmlAttr(process.env.VITE_APP_DESCRIPTION);
process.env.VITE_APP_LOGO_URL ??= process.env.OVERVIEW_LOGO_URL ?? 'https://public-frontend-cos.metadl.com/mgx/img/favicon_atoms.ico';

function ensureBuildOutDir() {
  let outDir = path.resolve(__dirname, 'dist');

  return {
    name: 'ensure-build-out-dir',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      fs.mkdirSync(outDir, { recursive: true });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const blogPrerenderRoutes = command === 'build' ? getBlogRoutes() : [];

  return {
    plugins: [
      viteSourceLocator({
        prefix: 'mgx', // Prefix used to identify source locations; do not change.
      }),
      react(),
      atoms(),
      ensureBuildOutDir(),
      Sitemap({
        hostname: 'https://atoms.template.com',
        lastmod: getSitemapLastmod(),
        readable: true,
        generateRobotsTxt: true,
      }),
      ...(blogPrerenderRoutes.length > 0
        ? vitePrerenderPlugin({
            renderTarget: '#root',
            prerenderScript: path.resolve(__dirname, 'prerender/blog.js'),
            additionalPrerenderRoutes: blogPrerenderRoutes,
          })
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0', // Listen on all network interfaces.
      port: parseInt(process.env.VITE_PORT || '3000'),
      proxy: {
        '/api': {
          target: `http://localhost:${process.env.BACKEND_PORT || '8000'}`,
          changeOrigin: true,
        },
      },
      watch: { usePolling: true, interval: 600 },
    },
    build: {
      rollupOptions: {
        output: {
          // Tek dosyada devasa bir paket üretmek yayın sunucusunda hataya yol
          // açıyor. Bu yüzden ağır kütüphaneleri ayrı parçalara bölüyoruz.
          manualChunks(id: string) {
            const normalized = id.split(path.sep).join('/');

            // PDF gömülü fontları megabaytlarca metin; ayrı parçada kalsın.
            if (normalized.includes('/src/scheduler/lib/roboto')) {
              return 'pdf-fonts';
            }
            if (!normalized.includes('node_modules')) {
              return undefined;
            }
            if (/node_modules\/(react|react-dom|scheduler)\//.test(normalized)) {
              return 'react-vendor';
            }
            if (normalized.includes('node_modules/react-router')) {
              return 'router-vendor';
            }
            if (normalized.includes('node_modules/@radix-ui')) {
              return 'ui-vendor';
            }
            if (
              normalized.includes('node_modules/recharts') ||
              normalized.includes('node_modules/d3-') ||
              normalized.includes('node_modules/victory-vendor')
            ) {
              return 'chart-vendor';
            }
            if (normalized.includes('node_modules/xlsx')) {
              return 'xlsx-vendor';
            }
            if (
              normalized.includes('node_modules/jspdf') ||
              normalized.includes('node_modules/html2canvas') ||
              normalized.includes('node_modules/canvg') ||
              normalized.includes('node_modules/dompurify')
            ) {
              return 'pdf-vendor';
            }
            if (normalized.includes('node_modules/pdfjs-dist')) {
              return 'pdfjs-vendor';
            }
            if (normalized.includes('node_modules/i18next')) {
              return 'i18n-vendor';
            }
            if (normalized.includes('node_modules/@tanstack')) {
              return 'query-vendor';
            }
            if (normalized.includes('node_modules/lucide-react')) {
              return 'icons-vendor';
            }
            if (
              normalized.includes('node_modules/react-hook-form') ||
              normalized.includes('node_modules/@hookform') ||
              normalized.includes('node_modules/zod')
            ) {
              return 'form-vendor';
            }
            if (
              normalized.includes('node_modules/axios') ||
              normalized.includes('node_modules/clsx') ||
              normalized.includes('node_modules/tailwind-merge') ||
              normalized.includes('node_modules/class-variance-authority') ||
              normalized.includes('node_modules/date-fns')
            ) {
              return 'utils-vendor';
            }
            return 'vendor';
          },
        },
      },
      chunkSizeWarningLimit: 1200,
    },
  };
});
