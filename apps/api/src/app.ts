import { randomUUID } from 'node:crypto';
import type { ErrorEnvelope } from '@eve/contracts';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { healthModule } from './modules/system/health/index.ts';

export interface BuildAppOptions {
  logger: boolean;
}

/**
 * Merakit instance Fastify App Pusat: compiler Zod, request id, 404 beramplop error, lalu modul.
 * Status: kerangka — baru modul `system/health`. Plugin database, auth, request-scope, error-handler,
 * openapi, rate-limit, dan cors ditambahkan di M3 (05-api/00-konvensi.md, 02-struktur-folder.md §2).
 */
export function buildApp(options: BuildAppOptions = { logger: false }) {
  const app = Fastify({ logger: options.logger, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.setNotFoundHandler((request, reply) => {
    const body: ErrorEnvelope = {
      error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.', requestId: request.id },
    };
    return reply.code(404).send(body);
  });
  const typed = app.withTypeProvider<ZodTypeProvider>();
  void typed.register(healthModule);
  return typed;
}
