import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // Terser rather than esbuild. It is not smaller uncompressed — it is about
    // four kilobytes larger — but it gzips a little tighter, and gzip is what
    // actually crosses a phone connection. The real reason is drop_console:
    // this ships as one static file with no build step between it and the
    // player, so anything left logging is left logging in production.
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2, drop_console: true },
      format: { comments: false },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
