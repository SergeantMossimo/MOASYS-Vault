import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // No global APIs — explicit imports keep the tests readable.
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        // Runner orchestration — covered by the manual `npm run scan:all`
        // smoke test rather than vitest.
        'src/scan.ts',
        'src/validate/runner.ts',
        // External-process / network orchestration. Testing these means
        // mocking spawn(), fetch(), and 3rd-party packages — high effort for
        // low value when their behavior is already verified by the smoke
        // test against the real library.
        'src/probe/ffprobe.ts',
        'src/probe/id3.ts',
        'src/validate/tmdb.ts',
        // Type-only files (constants are picked up but the actual exports
        // are types). Reporting them as 0% lines is misleading.
        'src/probe/types.ts',
        'src/validate/types.ts',
      ],
    },
  },
})
