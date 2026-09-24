import { errorEnvelopeSchema, healthResponseSchema } from '@eve/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../src/app.ts';

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('200 dengan bentuk kontrak dan header x-request-id', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: 'ok',
      service: 'api',
      checks: { database: 'not-configured' },
    });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('route tidak dikenal', () => {
  it('404 memakai amplop error tunggal dengan requestId yang sama dengan header', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/tidak-ada' });
    expect(response.statusCode).toBe(404);
    const body = errorEnvelopeSchema.parse(response.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
  });
});
