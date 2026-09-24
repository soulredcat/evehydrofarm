import { healthResponseSchema, type HealthResponse } from '@eve/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

export const healthRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get('/health', { schema: { response: { 200: healthResponseSchema } } }, () => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'api',
      checks: { database: 'not-configured' },
    };
    return body;
  });
  done();
};
