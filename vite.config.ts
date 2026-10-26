/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      globals: true,
    },
    define: {
      'import.meta.env.VITE_BOOKS_API_KEY': JSON.stringify(
        env.BOOKS_API_KEY || env.VITE_BOOKS_API_KEY,
      ),
      'process.env.VITE_BOOKS_API_KEY': JSON.stringify(
        env.BOOKS_API_KEY || env.VITE_BOOKS_API_KEY || '',
      ),
      'process.env.BOOKS_API_KEY': JSON.stringify(
        env.BOOKS_API_KEY || env.VITE_BOOKS_API_KEY || '',
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
    },
    optimizeDeps: {
      entries: [
        'index.html',
        'src/main.tsx',
        'src/pages/*.tsx',
        '!src/pages/*.test.tsx',
      ],
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-router-dom',
        '@tanstack/react-query',
        '@tanstack/react-query-persist-client',
        '@tanstack/query-async-storage-persister',
        '@trpc/client',
        '@trpc/react-query',
        'zustand',
        'zustand/middleware',
        'firebase/app',
        'firebase/auth',
        'lucide-react',
        'motion/react',
        'clsx',
        'tailwind-merge',
        'class-variance-authority',
        'sonner',
        'zod',
        'react-hook-form',
        '@hookform/resolvers/zod',
        '@radix-ui/react-checkbox',
        '@radix-ui/react-dialog',
        '@radix-ui/react-select',
        'react-virtuoso',
        'idb-keyval',
      ],
    },
    server: {
      hmr: false,
      watch: null,
      allowedHosts: true,
    },
    build: {
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router') ||
              id.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (id.includes('firebase')) {
              return 'vendor-firebase';
            }
            if (id.includes('@tanstack') || id.includes('@trpc')) {
              return 'vendor-data';
            }
            if (
              id.includes('lucide-react') ||
              id.includes('motion') ||
              id.includes('@radix-ui') ||
              id.includes('sonner')
            ) {
              return 'vendor-ui';
            }
            if (id.includes('@vis.gl') || id.includes('@googlemaps')) {
              return 'vendor-maps';
            }
            if (id.includes('zxing')) {
              return 'vendor-zxing';
            }
            if (id.includes('swiper')) {
              return 'vendor-swiper';
            }
            return undefined;
          },
        },
      },
    },
  };
});
