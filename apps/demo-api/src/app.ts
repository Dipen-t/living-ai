import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { PlannerProvider } from '@evolvekit/ai';
import {
  EvolutionError,
  EvolutionService,
  registerEvolutionRoutes,
  startPlannerWorker,
  type AuthorizationAdapter,
} from '@evolvekit/server';
import type { DemoSession, Permission, Principal } from '@evolvekit/core';
import {
  registry,
  legacyRegistry,
  numberFormatRegistry,
  ordersRegistry,
  actionRegistry,
  followUpsRegistry,
  customers,
} from '../../demo-erp/src/fixtures';
import { registerFollowUpRoutes } from './followups';
import { registerCodeRoutes, type CodeEngine } from './code';

export const demoAccounts: Record<string, DemoSession> = {
  requester: {
    displayName: 'Maya · Requester',
    principal: { applicationId: 'demo-erp', tenantId: 'demo-org', subjectId: 'maya' },
    permissions: [
      'code:read',
      'code:request',
      'code:submit',
      'evolution:read',
      'evolution:request',
      'evolution:refine',
      'evolution:submit',
      'followups:read',
      'followups:create',
      'followups:assign',
      'followups:complete',
    ],
  },
  approver: {
    displayName: 'Arun · Approver',
    principal: { applicationId: 'demo-erp', tenantId: 'demo-org', subjectId: 'arun' },
    permissions: [
      'code:read',
      'code:approve',
      'code:activate',
      'code:rollback',
      'evolution:read',
      'evolution:approve',
      'evolution:publish',
      'evolution:rollback',
      'evolution:audit',
      'followups:read',
      'followups:create',
      'followups:assign',
      'followups:complete',
    ],
  },
};

export async function createDemoApi(options: {
  databaseUrl: string;
  sessionSecret?: string;
  logger?: boolean;
  planner?: PlannerProvider;
  plannerMode?: 'local' | 'gemini' | 'test';
  runWorker?: boolean;
  codeEngine?: CodeEngine;
}) {
  const db = new PrismaClient({ datasources: { db: { url: options.databaseUrl } } });
  const app = Fastify({
    logger: options.logger
      ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'] }
      : false,
    bodyLimit: 65536,
    genReqId: () => randomUUID(),
  });
  const secret = options.sessionSecret ?? randomBytes(32).toString('hex');
  if (secret.length < 32)
    throw new Error('DEMO_SESSION_SECRET must contain at least 32 characters.');
  await app.register(cookie, { secret });
  function session(request: FastifyRequest): DemoSession {
    const signed = request.cookies.evolvekit_demo;
    if (!signed)
      throw new EvolutionError(401, 'UNAUTHENTICATED', 'Choose a demo account to continue.');
    const parsed = request.unsignCookie(signed);
    if (!parsed.valid || !parsed.value)
      throw new EvolutionError(
        401,
        'UNAUTHENTICATED',
        'Demo session is invalid. Choose an account again.',
      );
    const result = z
      .object({ account: z.enum(['requester', 'approver']), expires: z.number().int() })
      .safeParse(JSON.parse(parsed.value));
    if (!result.success || result.data.expires < Date.now())
      throw new EvolutionError(
        401,
        'UNAUTHENTICATED',
        'Demo session expired. Choose an account again.',
      );
    return demoAccounts[result.data.account];
  }
  const authorization: AuthorizationAdapter = {
    async authenticate(request) {
      return session(request as FastifyRequest).principal;
    },
    async authorize(principal: Principal, permission: Permission, resource) {
      const account = Object.values(demoAccounts).find(
        (a) => a.principal.subjectId === principal.subjectId,
      );
      if (
        !account ||
        account.principal.applicationId !== principal.applicationId ||
        account.principal.tenantId !== principal.tenantId ||
        resource.applicationId !== principal.applicationId ||
        resource.tenantId !== principal.tenantId ||
        !account.permissions.includes(permission)
      )
        return false;
      return (
        !resource.requesterId ||
        principal.subjectId === resource.requesterId ||
        principal.subjectId === 'arun'
      );
    },
  };
  const service = new EvolutionService(db, authorization, registry, [
    legacyRegistry,
    numberFormatRegistry,
    ordersRegistry,
    actionRegistry,
    followUpsRegistry,
  ]);
  await service.initialize([{ id: 'demo-org', name: 'Demo organization' }]);
  for (const customer of customers)
    await db.followUpCustomer.upsert({
      where: {
        applicationId_tenantId_id: {
          applicationId: 'demo-erp',
          tenantId: 'demo-org',
          id: String(customer.id),
        },
      },
      create: {
        applicationId: 'demo-erp',
        tenantId: 'demo-org',
        id: String(customer.id),
        name: String(customer.name),
        company: String(customer.company),
      },
      update: {},
    });
  await registerEvolutionRoutes(app, service, {
    allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
    plannerMode: options.planner ? (options.plannerMode ?? 'test') : 'unconfigured',
  });
  await registerFollowUpRoutes(app, db, session);
  const stopCodeWorker = await registerCodeRoutes(
    app,
    db,
    session,
    options.codeEngine,
    options.runWorker !== false,
  );
  app.get('/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return {
      status: 'ready',
      planner: options.planner ? (options.plannerMode ?? 'test') : 'unconfigured',
    };
  });
  app.get('/demo/session', async (request) => session(request));
  app.post('/demo/session', async (request, reply) => {
    const { account } = z
      .object({ account: z.enum(['requester', 'approver']) })
      .strict()
      .parse(request.body);
    reply.setCookie(
      'evolvekit_demo',
      JSON.stringify({ account, expires: Date.now() + 8 * 3600000 }),
      { signed: true, httpOnly: true, sameSite: 'strict', path: '/', maxAge: 8 * 3600 },
    );
    return demoAccounts[account];
  });
  const stopWorker =
    options.planner && options.runWorker !== false
      ? startPlannerWorker(service, options.planner, () =>
          app.log.error(
            { code: 'PLANNER_WORKER_FAILED' },
            'Planner worker could not complete a transaction',
          ),
        )
      : async () => {};
  app.addHook('onClose', async () => {
    await stopCodeWorker();
    await stopWorker();
    await db.$disconnect();
  });
  return { app, service, db };
}
