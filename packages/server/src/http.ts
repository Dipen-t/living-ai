import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { ConfigurationError } from '@evolvekit/core';
import { EvolutionError, type EvolutionService, type ActionContext } from './service';

const uuid = z.string().uuid(),
  generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  pageId = z.string().min(1).max(100),
  text = z.string().trim().min(1).max(4000);
const action = z
  .object({
    revisionId: uuid,
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedLockVersion: z.number().int().nonnegative(),
  })
  .strict();
const proposalParams = z.object({ id: uuid }).strict(),
  pageQuery = z.object({ pageId }).strict();
const idem = (request: FastifyRequest) =>
  z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(request.headers['idempotency-key']);

export async function registerEvolutionRoutes(
  app: FastifyInstance,
  service: EvolutionService,
  options: { allowedOrigins: string[]; plannerMode?: string },
) {
  const context = async (request: FastifyRequest): Promise<ActionContext> => ({
    principal: await service.authorization.authenticate(request),
    correlationId: request.id,
  });
  app.addHook('onRequest', async (request) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !options.allowedOrigins.includes(String(request.headers.origin ?? ''))
    )
      throw new EvolutionError(403, 'ORIGIN_DENIED', 'Request origin is not allowed.');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ConfigurationError)
      return reply.code(422).send({
        code: 'INVALID_CONFIGURATION',
        message: error.message,
        details: error.errors,
        correlationId: request.id,
      });
    if (error instanceof ZodError)
      return reply.code(422).send({
        code: 'INVALID_REQUEST',
        message: 'Request does not match the API contract.',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        correlationId: request.id,
      });
    if (error instanceof EvolutionError)
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message, correlationId: request.id });
    request.log.error({ err: error, correlationId: request.id }, 'Request failed');
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: 'The operation could not be completed.',
      correlationId: request.id,
    });
  });
  app.get('/v1/configurations/active', async (req, reply) => {
    const config = await service.getActive(await context(req), pageQuery.parse(req.query).pageId),
      etag = `"${config.generation}-${config.configurationHash}"`;
    reply
      .header('Cache-Control', 'private, no-cache')
      .header('ETag', etag)
      .header('Vary', 'Cookie');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return config;
  });
  app.get('/v1/capabilities', async (req) => {
    const id = pageQuery.parse(req.query).pageId;
    await service.getActive(await context(req), id);
    return {
      registryVersionId: service.registryVersionId,
      page: service.registry.pages.find((p) => p.pageId === id),
    };
  });
  app.post('/v1/evolution-requests', async (req, reply) => {
    if (!(req.body && typeof req.body === 'object' && 'operations' in req.body)) {
      if (!options.plannerMode || options.plannerMode === 'unconfigured')
        throw new EvolutionError(
          503,
          'PLANNER_UNCONFIGURED',
          'Proposal planner is not configured. Use guided controls.',
        );
      const input = z
        .object({ pageId, text, expectedGeneration: generation })
        .strict()
        .parse(req.body);
      return reply
        .code(202)
        .send(
          await service.enqueueRequest(await context(req), { ...input, idempotencyKey: idem(req) }),
        );
    }
    const input = z
      .object({ pageId, text, operations: z.unknown(), expectedGeneration: generation })
      .strict()
      .parse(req.body);
    return reply.code(201).send(
      await service.createRequest(await context(req), {
        ...input,
        operations: input.operations,
        idempotencyKey: idem(req),
      }),
    );
  });
  app.get('/v1/proposals', async (req) =>
    service.listProposals(await context(req), pageQuery.parse(req.query).pageId),
  );
  app.get('/v1/proposals/:id/preview', async (req) => {
    const query = z.object({ revisionId: uuid.optional() }).strict().parse(req.query);
    return service.getRevision(
      await context(req),
      proposalParams.parse(req.params).id,
      query.revisionId,
    );
  });
  app.post('/v1/proposals/:id/revisions', async (req, reply) => {
    if (!(req.body && typeof req.body === 'object' && 'operations' in req.body)) {
      const input = z
        .object({
          parentRevisionId: uuid,
          expectedLockVersion: z.number().int().nonnegative(),
          refinement: text,
        })
        .strict()
        .parse(req.body);
      if (!options.plannerMode || options.plannerMode === 'unconfigured')
        throw new EvolutionError(
          503,
          'PLANNER_UNCONFIGURED',
          'Proposal planner is not configured. Use guided controls.',
        );
      return reply.code(202).send(
        await service.enqueueRefinement(await context(req), proposalParams.parse(req.params).id, {
          ...input,
          idempotencyKey: idem(req),
        }),
      );
    }
    const input = z
      .object({
        parentRevisionId: uuid,
        expectedLockVersion: z.number().int().nonnegative(),
        operations: z.unknown(),
        refinement: text,
      })
      .strict()
      .parse(req.body);
    return service.refine(await context(req), proposalParams.parse(req.params).id, {
      ...input,
      operations: input.operations,
      idempotencyKey: idem(req),
    });
  });
  app.post('/v1/proposals/:id/submit', async (req) => {
    const { previewAcknowledged, ...input } = action
      .extend({ previewAcknowledged: z.literal(true) })
      .strict()
      .parse(req.body);
    return service.submit(await context(req), proposalParams.parse(req.params).id, input);
  });
  app.post('/v1/proposals/:id/approve', async (req) =>
    service.approve(
      await context(req),
      proposalParams.parse(req.params).id,
      action.parse(req.body),
    ),
  );
  app.post('/v1/proposals/:id/reject', async (req) =>
    service.reject(
      await context(req),
      proposalParams.parse(req.params).id,
      action.extend({ reason: text.optional() }).strict().parse(req.body),
    ),
  );
  app.post('/v1/configurations/publish', async (req) => {
    const input = z
      .object({ revisionId: uuid, expectedGeneration: generation })
      .strict()
      .parse(req.body);
    return service.publish(await context(req), { ...input, idempotencyKey: idem(req) });
  });
  app.post('/v1/configurations/rollback', async (req) => {
    const input = z
      .object({ pageId, targetVersionId: uuid, expectedGeneration: generation, reason: text })
      .strict()
      .parse(req.body);
    return service.rollback(await context(req), { ...input, idempotencyKey: idem(req) });
  });
  app.get('/v1/configurations/history', async (req) =>
    service.history(await context(req), pageQuery.parse(req.query).pageId),
  );
  app.get('/v1/audit-events', async (req) =>
    service.auditEvents(await context(req), pageQuery.parse(req.query).pageId),
  );
  app.get('/v1/planner', async (req) => {
    await service.getActive(await context(req), pageQuery.parse(req.query).pageId);
    return { mode: options.plannerMode ?? 'unconfigured' };
  });
  app.get('/v1/planner-jobs', async (req) =>
    service.listPlannerJobs(await context(req), pageQuery.parse(req.query).pageId),
  );
  app.get('/v1/planner-jobs/:id', async (req) =>
    service.getPlannerJob(await context(req), proposalParams.parse(req.params).id),
  );
}
