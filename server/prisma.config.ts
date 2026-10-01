import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations should use a direct (non-pooled) connection on Neon.
// DIRECT_URL falls back to DATABASE_URL for local development.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
