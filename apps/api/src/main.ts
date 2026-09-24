import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';

// `.env` operator ada di root repo (10-kualitas-pengujian.md §2).
const envFile = resolve(import.meta.dirname, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = loadEnv(process.env);
const app = buildApp({ logger: true });
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
