import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { EvolutionError, contentHash } from '@evolvekit/server';
import type { DemoSession, Permission } from '@evolvekit/core';

const owner = z.enum(['maya', 'arun']);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  );
const createSchema = z
  .object({
    customerId: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    ownerId: owner,
    dueDate: date,
  })
  .strict();
const updateSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    ownerId: owner.optional(),
    status: z.enum(['pending', 'completed']).optional(),
  })
  .strict()
  .refine((value) => value.ownerId !== undefined || value.status !== undefined);
type Tx = Prisma.TransactionClient;
export async function registerFollowUpRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  session: (request: FastifyRequest) => DemoSession,
) {
  const scope = (identity: DemoSession) => ({
    applicationId: identity.principal.applicationId,
    tenantId: identity.principal.tenantId,
  });
  async function allow(request: FastifyRequest, permission: Permission) {
    const identity = session(request);
    if (!identity.permissions.includes(permission))
      throw new EvolutionError(
        403,
        'FORBIDDEN',
        'Your account cannot perform this follow-up action.',
      );
    return identity;
  }
  async function enabled(tx: Tx, identity: DemoSession) {
    const { applicationId, tenantId } = scope(identity);
    await tx.$queryRaw`SELECT "pageId" FROM "ActiveConfiguration" WHERE "applicationId"=${applicationId} AND "tenantId"=${tenantId} AND "pageId"='customers' FOR SHARE`;
    const active = await tx.activeConfiguration.findUnique({
      where: { applicationId_tenantId_pageId: { ...scope(identity), pageId: 'customers' } },
    });
    const version =
      active && (await tx.configurationVersion.findUnique({ where: { id: active.versionId } }));
    if (
      !(
        version?.configuration as { enabledFeatures?: string[] } | undefined
      )?.enabledFeatures?.includes('customer-followups')
    )
      throw new EvolutionError(
        409,
        'WORKFLOW_INACTIVE',
        'Customer follow-ups need to be approved and activated first.',
      );
  }
  async function audit(
    tx: Tx,
    request: FastifyRequest,
    identity: DemoSession,
    type: string,
    resourceId: string,
    metadata: Prisma.InputJsonValue = {},
  ) {
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        ...scope(identity),
        pageId: 'customers',
        actorId: identity.principal.subjectId,
        correlationId: request.id,
        eventType: type,
        resourceId,
        metadata,
      },
    });
  }
  const dto = (task: {
    id: string;
    customerId: string;
    title: string;
    ownerId: string;
    dueDate: Date;
    status: string;
    lockVersion: number;
    createdBy: string;
    completedAt: Date | null;
    customer: { name: string; company: string };
  }) => ({
    id: task.id,
    customerId: task.customerId,
    customerName: task.customer.name,
    company: task.customer.company,
    title: task.title,
    ownerId: task.ownerId,
    dueDate: task.dueDate.toISOString().slice(0, 10),
    status: task.status,
    version: task.lockVersion,
    createdBy: task.createdBy,
    completedAt: task.completedAt?.toISOString() ?? null,
  });
  app.get('/v1/followups/context', async (request) => {
    const identity = await allow(request, 'followups:read');
    return db.$transaction(async (tx) => {
      await enabled(tx, identity);
      return {
        customers: await tx.followUpCustomer.findMany({
          where: scope(identity),
          select: { id: true, name: true, company: true },
          orderBy: { name: 'asc' },
        }),
        owners: [
          { id: 'maya', name: 'Maya' },
          { id: 'arun', name: 'Arun' },
        ],
        subjectId: identity.principal.subjectId,
        canManage: identity.principal.subjectId === 'arun',
      };
    });
  });
  app.get('/v1/followups', async (request) => {
    const identity = await allow(request, 'followups:read');
    return db.$transaction(async (tx) => {
      await enabled(tx, identity);
      return (
        await tx.followUp.findMany({
          where: scope(identity),
          include: { customer: true },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          take: 500,
        })
      ).map(dto);
    });
  });
  app.post('/v1/followups', async (request) => {
    const identity = await allow(request, 'followups:create');
    const input = createSchema.parse(request.body);
    if (input.ownerId !== identity.principal.subjectId) await allow(request, 'followups:assign');
    const key = z.string().uuid().parse(request.headers['idempotency-key']);
    return db.$transaction(async (tx) => {
      await enabled(tx, identity);
      const idem = {
        ...scope(identity),
        actorId: identity.principal.subjectId,
        routeKey: 'followups:create',
        key,
      };
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(idem)}, 0))::text AS locked`;
      const existing = await tx.idempotencyKey.findUnique({
        where: { applicationId_tenantId_actorId_routeKey_key: idem },
      });
      if (existing) {
        if (existing.requestHash !== contentHash(input))
          throw new EvolutionError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This request key was already used for another follow-up.',
          );
        return existing.response;
      }
      if (
        !(await tx.followUpCustomer.findUnique({
          where: { applicationId_tenantId_id: { ...scope(identity), id: input.customerId } },
        }))
      )
        throw new EvolutionError(404, 'NOT_FOUND', 'Customer does not exist in this workspace.');
      const task = await tx.followUp.create({
        data: {
          id: randomUUID(),
          ...scope(identity),
          ...input,
          dueDate: new Date(`${input.dueDate}T00:00:00Z`),
          createdBy: identity.principal.subjectId,
        },
        include: { customer: true },
      });
      const result = dto(task);
      await audit(tx, request, identity, 'FollowUpCreated', task.id, {
        customerId: task.customerId,
        ownerId: task.ownerId,
        dueDate: input.dueDate,
        version: 0,
      });
      await tx.idempotencyKey.create({
        data: { ...idem, requestHash: contentHash(input), response: result },
      });
      return result;
    });
  });
  app.post('/v1/followups/:id', async (request) => {
    const identity = session(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = updateSchema.parse(request.body);
    if (input.ownerId !== undefined) await allow(request, 'followups:assign');
    if (input.status !== undefined) await allow(request, 'followups:complete');
    return db.$transaction(async (tx) => {
      await enabled(tx, identity);
      const task = await tx.followUp.findFirst({ where: { id, ...scope(identity) } });
      if (!task)
        throw new EvolutionError(404, 'NOT_FOUND', 'Follow-up does not exist in this workspace.');
      const actor = identity.principal.subjectId;
      if (
        actor !== 'arun' &&
        ((input.ownerId !== undefined && task.createdBy !== actor) ||
          (input.status !== undefined && task.ownerId !== actor))
      )
        throw new EvolutionError(
          403,
          'FORBIDDEN',
          'Only the owner can complete this task; only its creator or a manager can reassign it.',
        );
      const result = await tx.followUp.updateMany({
        where: { id, ...scope(identity), lockVersion: input.expectedVersion },
        data: {
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
          ...(input.status
            ? {
                status: input.status,
                completedBy: input.status === 'completed' ? actor : null,
                completedAt: input.status === 'completed' ? new Date() : null,
              }
            : {}),
          lockVersion: { increment: 1 },
        },
      });
      if (!result.count)
        throw new EvolutionError(
          409,
          'STALE_FOLLOWUP',
          'This follow-up changed. Refresh it before trying again.',
        );
      await audit(
        tx,
        request,
        identity,
        input.status ? 'FollowUpStatusChanged' : 'FollowUpAssigned',
        id,
        {
          previousOwnerId: task.ownerId,
          ownerId: input.ownerId ?? task.ownerId,
          previousStatus: task.status,
          status: input.status ?? task.status,
          version: input.expectedVersion + 1,
        },
      );
      return dto(
        await tx.followUp.findUniqueOrThrow({ where: { id }, include: { customer: true } }),
      );
    });
  });
}
