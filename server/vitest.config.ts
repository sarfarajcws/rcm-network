import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rcm_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
      BCRYPT_ROUNDS: '4',
      CORS_ORIGIN: 'http://localhost:5173',
    },
  },
});
