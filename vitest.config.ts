import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'html'],
      // Objective of PROJECT_CONTEXT.md §10.
      thresholds: {
        'src/context/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/security/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
