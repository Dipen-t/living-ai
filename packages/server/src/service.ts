import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type PlannerJob } from '@prisma/client';
import {
  parseCandidate,
  PlannerError,
  type PlannerInput,
  type PlannerProvider,
} from '@evolvekit/ai';
import {
  applyOperations,
  canonicalize,
  isAdditiveRegistryChange,
  ConfigurationError,
  validateConfiguration,
  validateOperations,
  validateRegistry,
  type CapabilityRegistry,
  type ConfigurationEnvelope,
  type ConfigurationHistory,
  type Permission,
  type PlannerJobEnvelope,
  type PlannerJobStatus,
  type Principal,
  type RevisionEnvelope,
  type RevisionState,
  type Scope,
  type TableConfiguration,
} from '@evolvekit/core';

export interface AuthorizationAdapter {
  authenticate(request: unknown): Promise<Principal>;
  authorize(
    principal: Principal,
    permission: Permission,
    resource: Scope & { requesterId?: string },
  ): Promise<boolean>;
}
export interface ActionContext {
  principal: Principal;
  correlationId: string;
}
export class EvolutionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
type Tx = Prisma.TransactionClient;
type WriteInput = { idempotencyKey: string; [key: string]: unknown };
type RevisionAction = {
  revisionId: string;
  configurationHash: string;
  expectedLockVersion: number;
};
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const contentHash = (value: unknown) =>
  createHash('sha256').update(canonicalize(value)).digest('hex');
function conflict(message: string): never {
  throw new EvolutionError(409, 'STALE_STATE', message);
}
function notFound(): never {
  throw new EvolutionError(404, 'NOT_FOUND', 'Resource was not found in your scope.');
}

export class EvolutionService {
  readonly registry: CapabilityRegistry;
  readonly registryVersionId: string;
  readonly compatibleRegistries = new Map<string, CapabilityRegistry>();
  constructor(
    readonly db: PrismaClient,
    readonly authorization: AuthorizationAdapter,
    registry: CapabilityRegistry,
    previousRegistries: CapabilityRegistry[] = [],
  ) {
    const result = validateRegistry(registry);
    if (!result.success) throw new ConfigurationError(result.errors);
    this.registry = result.data;
    this.registryVersionId = contentHash(this.registry);
    for (const previous of previousRegistries) {
      if (!isAdditiveRegistryChange(previous, this.registry))
        throw new Error(
          'Compatible registry must be an unchanged contract with added operations only.',
        );
      this.compatibleRegistries.set(contentHash(previous), previous);
    }
  }
  private page(pageId: string) {
    return this.registry.pages.find((page) => page.pageId === pageId) ?? notFound();
  }
  private scope(ctx: ActionContext, pageId: string): Scope {
    if (ctx.principal.applicationId !== this.registry.applicationId) notFound();
    this.page(pageId);
    return { applicationId: ctx.principal.applicationId, tenantId: ctx.principal.tenantId, pageId };
  }
  private async audit(
    tx: Tx | PrismaClient,
    ctx: ActionContext,
    eventType: string,
    pageId?: string,
    resourceId?: string,
    metadata: unknown = {},
  ) {
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        applicationId: ctx.principal.applicationId,
        tenantId: ctx.principal.tenantId,
        actorId: ctx.principal.subjectId,
        correlationId: ctx.correlationId,
        eventType,
        pageId,
        resourceId,
        metadata: json(metadata),
      },
    });
  }
  private async allow(
    ctx: ActionContext,
    permission: Permission,
    resource: Scope & { requesterId?: string },
  ) {
    if (!(await this.authorization.authorize(ctx.principal, permission, resource))) {
      await this.audit(this.db, ctx, 'PermissionDenied', resource.pageId, undefined, {
        permission,
      });
      throw new EvolutionError(
        403,
        'FORBIDDEN',
        'Your account does not have permission for this action.',
      );
    }
  }
  private async guard<T>(ctx: ActionContext, pageId: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ConfigurationError)
        await this.audit(this.db, ctx, 'ValidationFailed', pageId, undefined, {
          codes: error.errors.map((e) => e.code),
        });
      throw error;
    }
  }
  private async active(tx: Tx | PrismaClient, scope: Scope) {
    return (
      (await tx.activeConfiguration.findUnique({
        where: { applicationId_tenantId_pageId: scope },
      })) ?? notFound()
    );
  }
  private async lockActive(tx: Tx, scope: Scope) {
    await tx.$queryRaw`SELECT "pageId" FROM "ActiveConfiguration" WHERE "applicationId"=${scope.applicationId} AND "tenantId"=${scope.tenantId} AND "pageId"=${scope.pageId} FOR UPDATE`;
    return this.active(tx, scope);
  }
  private async proposal(
    tx: Tx | PrismaClient,
    ctx: ActionContext,
    proposalId: string,
    lock = false,
  ) {
    const scope = { applicationId: ctx.principal.applicationId, tenantId: ctx.principal.tenantId };
    if (lock)
      await tx.$queryRaw`SELECT "id" FROM "Proposal" WHERE "id"=${proposalId} AND "applicationId"=${scope.applicationId} AND "tenantId"=${scope.tenantId} FOR UPDATE`;
    const proposal =
      (await tx.proposal.findFirst({ where: { id: proposalId, ...scope } })) ?? notFound();
    this.scope(ctx, proposal.pageId);
    const request =
      (await tx.evolutionRequest.findFirst({ where: { id: proposal.requestId, ...scope } })) ??
      notFound();
    return { ...proposal, requesterId: request.requesterId, text: request.text };
  }
  private async revision(tx: Tx | PrismaClient, ctx: ActionContext, revisionId: string) {
    return (
      (await tx.proposalRevision.findFirst({
        where: {
          id: revisionId,
          applicationId: ctx.principal.applicationId,
          tenantId: ctx.principal.tenantId,
        },
      })) ?? notFound()
    );
  }
  private async envelope(
    tx: Tx | PrismaClient,
    ctx: ActionContext,
    revisionId: string,
  ): Promise<RevisionEnvelope> {
    const revision = await this.revision(tx, ctx, revisionId);
    const lifecycle =
      (await tx.revisionLifecycle.findUnique({ where: { revisionId } })) ?? notFound();
    const proposal = await this.proposal(tx, ctx, revision.proposalId);
    const base =
      (await tx.configurationVersion.findFirst({
        where: {
          id: revision.baseVersionId,
          applicationId: revision.applicationId,
          tenantId: revision.tenantId,
          pageId: revision.pageId,
        },
      })) ?? notFound();
    return {
      proposalId: proposal.id,
      revisionId,
      revisionNumber: revision.revisionNumber,
      requesterId: proposal.requesterId,
      text: revision.refinementText || proposal.text,
      state: lifecycle.state as RevisionState,
      lockVersion: lifecycle.lockVersion,
      baseVersionId: revision.baseVersionId,
      baseGeneration: Number(revision.baseGeneration),
      baseConfiguration: base.configuration as unknown as TableConfiguration,
      registryVersionId: revision.registryVersionId,
      configurationHash: revision.configurationHash,
      configuration: revision.configuration as unknown as TableConfiguration,
      operations: revision.operations as unknown as RevisionEnvelope['operations'],
      createdAt: revision.createdAt.toISOString(),
    };
  }
  private async configEnvelope(
    tx: Tx | PrismaClient,
    scope: Scope,
  ): Promise<ConfigurationEnvelope> {
    const active = await this.active(tx, scope);
    const version =
      (await tx.configurationVersion.findFirst({ where: { id: active.versionId, ...scope } })) ??
      notFound();
    return {
      versionId: version.id,
      registryVersionId: version.registryVersionId,
      schemaVersion: 1,
      configurationHash: version.configurationHash,
      configuration: version.configuration as unknown as TableConfiguration,
      generation: Number(active.generation),
    };
  }
  private async compatible(tx: Tx, applicationId: string, registryVersionId: string) {
    const application =
      (await tx.application.findUnique({ where: { id: applicationId } })) ?? notFound();
    if (
      (registryVersionId !== this.registryVersionId &&
        !this.compatibleRegistries.has(registryVersionId)) ||
      application.registryVersionId !== this.registryVersionId
    )
      throw new EvolutionError(
        409,
        'INCOMPATIBLE_REGISTRY',
        'Registry changed. Create and review a new proposal.',
      );
  }
  private validateStored(configuration: unknown, pageId: string, hash: string) {
    const checked = validateConfiguration(configuration, this.page(pageId));
    if (!checked.success) throw new ConfigurationError(checked.errors);
    if (contentHash(checked.data) !== hash)
      throw new EvolutionError(
        409,
        'HASH_MISMATCH',
        'Stored configuration differs from its approved hash.',
      );
    return checked.data;
  }
  private async validation(
    tx: Tx,
    ctx: ActionContext,
    revision: { id: string; pageId: string; configurationHash: string },
    phase: string,
  ) {
    await tx.validationRun.create({
      data: {
        id: randomUUID(),
        ...this.scope(ctx, revision.pageId),
        revisionId: revision.id,
        phase,
        validatorVersion: 'core-v1',
        configurationHash: revision.configurationHash,
        result: 'valid',
      },
    });
  }
  private async idempotent<T>(
    tx: Tx,
    ctx: ActionContext,
    routeKey: string,
    input: WriteInput,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = {
      applicationId: ctx.principal.applicationId,
      tenantId: ctx.principal.tenantId,
      actorId: ctx.principal.subjectId,
      routeKey,
      key: input.idempotencyKey,
    };
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalize(key)}, 0))::text AS locked`;
    const hash = contentHash(input);
    const existing = await tx.idempotencyKey.findUnique({
      where: { applicationId_tenantId_actorId_routeKey_key: key },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new EvolutionError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This key was used for a different request.',
        );
      return existing.response as unknown as T;
    }
    const result = await action();
    await tx.idempotencyKey.create({ data: { ...key, requestHash: hash, response: json(result) } });
    return result;
  }
  async initialize(tenants: { id: string; name: string }[]) {
    await this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`registry:${this.registry.applicationId}`}, 0))`;
        const existing = await tx.registryVersion.findUnique({
          where: {
            applicationId_versionLabel: {
              applicationId: this.registry.applicationId,
              versionLabel: this.registry.version,
            },
          },
        });
        if (existing && existing.contentHash !== this.registryVersionId)
          throw new Error('Registry label cannot be reused for different content.');
        if (!existing)
          await tx.registryVersion.create({
            data: {
              id: this.registryVersionId,
              applicationId: this.registry.applicationId,
              versionLabel: this.registry.version,
              content: json(this.registry),
              contentHash: this.registryVersionId,
              installedBy: 'integration',
            },
          });
        const application = await tx.application.upsert({
          where: { id: this.registry.applicationId },
          create: {
            id: this.registry.applicationId,
            name: this.registry.applicationId,
            registryVersionId: this.registryVersionId,
          },
          update: {},
        });
        if (application.registryVersionId !== this.registryVersionId) {
          const previous = this.compatibleRegistries.get(application.registryVersionId);
          const stored = await tx.registryVersion.findUnique({
            where: { id: application.registryVersionId },
          });
          if (!previous || !stored || contentHash(stored.content) !== contentHash(previous))
            throw new Error('Explicit registry migration is required.');
          await tx.application.update({
            where: { id: application.id },
            data: { registryVersionId: this.registryVersionId },
          });
          for (const tenant of await tx.tenant.findMany({
            where: { applicationId: application.id },
          }))
            await this.audit(
              tx,
              {
                principal: {
                  applicationId: application.id,
                  tenantId: tenant.id,
                  subjectId: 'integration',
                },
                correlationId: randomUUID(),
              },
              'RegistryExtended',
              undefined,
              this.registryVersionId,
              { previousRegistryVersionId: application.registryVersionId },
            );
        }
        for (const tenant of tenants) {
          await tx.tenant.upsert({
            where: { applicationId_id: { applicationId: application.id, id: tenant.id } },
            create: { applicationId: application.id, ...tenant },
            update: {},
          });
          for (const page of this.registry.pages) {
            const scope = {
              applicationId: application.id,
              tenantId: tenant.id,
              pageId: page.pageId,
            };
            if (
              await tx.activeConfiguration.findUnique({
                where: { applicationId_tenantId_pageId: scope },
              })
            )
              continue;
            const versionId = randomUUID();
            await tx.configurationVersion.create({
              data: {
                id: versionId,
                ...scope,
                registryVersionId: this.registryVersionId,
                configuration: json(page.baseline),
                configurationHash: contentHash(page.baseline),
                createdBy: 'integration',
              },
            });
            await tx.activeConfiguration.create({ data: { ...scope, versionId, generation: 1n } });
            await tx.activationEvent.create({
              data: {
                id: randomUUID(),
                ...scope,
                generation: 1n,
                versionId,
                kind: 'baseline',
                actorId: 'integration',
              },
            });
            await this.audit(
              tx,
              {
                principal: {
                  applicationId: application.id,
                  tenantId: tenant.id,
                  subjectId: 'integration',
                },
                correlationId: randomUUID(),
              },
              'BaselineInstalled',
              page.pageId,
              versionId,
            );
          }
        }
      },
      { timeout: 15000 },
    );
  }
  async getActive(ctx: ActionContext, pageId: string) {
    const scope = this.scope(ctx, pageId);
    await this.allow(ctx, 'evolution:read', scope);
    return this.configEnvelope(this.db, scope);
  }
  async getRevision(ctx: ActionContext, proposalId: string, revisionId?: string) {
    const proposal = await this.proposal(this.db, ctx, proposalId);
    await this.allow(ctx, 'evolution:read', {
      ...this.scope(ctx, proposal.pageId),
      requesterId: proposal.requesterId,
    });
    const envelope = await this.envelope(
      this.db,
      ctx,
      revisionId ?? proposal.currentRevisionId ?? notFound(),
    );
    if (envelope.proposalId !== proposalId) notFound();
    return envelope;
  }
  async listProposals(ctx: ActionContext, pageId: string) {
    const scope = this.scope(ctx, pageId);
    await this.allow(ctx, 'evolution:read', scope);
    const proposals = await this.db.proposal.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const results: RevisionEnvelope[] = [];
    for (const p of proposals) {
      const request = await this.db.evolutionRequest.findUnique({ where: { id: p.requestId } });
      if (
        p.currentRevisionId &&
        request &&
        (await this.authorization.authorize(ctx.principal, 'evolution:read', {
          ...scope,
          requesterId: request.requesterId,
        }))
      )
        results.push(await this.envelope(this.db, ctx, p.currentRevisionId));
    }
    return results;
  }
  async createRequest(
    ctx: ActionContext,
    input: WriteInput & {
      pageId: string;
      text: string;
      operations: unknown;
      expectedGeneration: number;
    },
  ) {
    const scope = this.scope(ctx, input.pageId);
    await this.allow(ctx, 'evolution:request', scope);
    return this.guard(ctx, input.pageId, () =>
      this.db.$transaction(
        (tx) =>
          this.idempotent(tx, ctx, 'request', input, async () => {
            const active = await this.active(tx, scope);
            if (active.generation !== BigInt(input.expectedGeneration))
              conflict('Active configuration changed. Refresh before saving.');
            await this.compatible(tx, scope.applicationId, this.registryVersionId);
            const base =
              (await tx.configurationVersion.findFirst({
                where: { id: active.versionId, ...scope },
              })) ?? notFound();
            const validated = validateOperations(input.operations, this.page(input.pageId));
            if (!validated.success) throw new ConfigurationError(validated.errors);
            const configuration = applyOperations(
              base.configuration as unknown as TableConfiguration,
              validated.data,
              this.page(input.pageId),
            );
            const requestId = randomUUID(),
              proposalId = randomUUID(),
              revisionId = randomUUID();
            await tx.evolutionRequest.create({
              data: {
                id: requestId,
                ...scope,
                requesterId: ctx.principal.subjectId,
                text: input.text,
              },
            });
            await tx.proposal.create({ data: { id: proposalId, ...scope, requestId } });
            const revision = await tx.proposalRevision.create({
              data: {
                id: revisionId,
                ...scope,
                proposalId,
                revisionNumber: 1,
                registryVersionId: this.registryVersionId,
                baseVersionId: active.versionId,
                baseGeneration: active.generation,
                operations: json(validated.data),
                configuration: json(configuration),
                configurationHash: contentHash(configuration),
                refinementText: '',
                createdBy: ctx.principal.subjectId,
              },
            });
            await tx.revisionLifecycle.create({
              data: { revisionId, ...scope, state: 'ReadyForPreview' },
            });
            await tx.proposal.update({
              where: { id: proposalId },
              data: { currentRevisionId: revisionId },
            });
            await this.validation(tx, ctx, revision, 'creation');
            await this.audit(tx, ctx, 'ProposalCreated', input.pageId, revisionId);
            return this.envelope(tx, ctx, revisionId);
          }),
        { timeout: 15000 },
      ),
    );
  }
  async refine(
    ctx: ActionContext,
    proposalId: string,
    input: WriteInput & {
      parentRevisionId: string;
      expectedLockVersion: number;
      operations: unknown;
      refinement: string;
    },
  ) {
    const loaded = await this.proposal(this.db, ctx, proposalId),
      scope = this.scope(ctx, loaded.pageId);
    await this.allow(ctx, 'evolution:refine', { ...scope, requesterId: loaded.requesterId });
    return this.guard(ctx, loaded.pageId, () =>
      this.db.$transaction(
        (tx) =>
          this.idempotent(tx, ctx, `refine:${proposalId}`, input, async () => {
            const proposal = await this.proposal(tx, ctx, proposalId, true);
            await this.allow(ctx, 'evolution:refine', {
              ...scope,
              requesterId: proposal.requesterId,
            });
            if (proposal.currentRevisionId !== input.parentRevisionId)
              conflict('A newer revision exists. Refresh before refining.');
            const parent = await this.revision(tx, ctx, input.parentRevisionId);
            const lifecycle =
              (await tx.revisionLifecycle.findUnique({ where: { revisionId: parent.id } })) ??
              notFound();
            if (
              lifecycle.lockVersion !== input.expectedLockVersion ||
              !['ReadyForPreview', 'PendingApproval', 'Approved'].includes(lifecycle.state)
            )
              conflict('This revision can no longer be refined. Start a new proposal.');
            await this.compatible(tx, scope.applicationId, parent.registryVersionId);
            const base =
              (await tx.configurationVersion.findFirst({
                where: { id: parent.baseVersionId, ...scope },
              })) ?? notFound();
            const validated = validateOperations(input.operations, this.page(scope.pageId));
            if (!validated.success) throw new ConfigurationError(validated.errors);
            const configuration = applyOperations(
              base.configuration as unknown as TableConfiguration,
              validated.data,
              this.page(scope.pageId),
            );
            const revisionId = randomUUID();
            const revision = await tx.proposalRevision.create({
              data: {
                id: revisionId,
                ...scope,
                proposalId,
                revisionNumber: parent.revisionNumber + 1,
                parentRevisionId: parent.id,
                registryVersionId: this.registryVersionId,
                baseVersionId: parent.baseVersionId,
                baseGeneration: parent.baseGeneration,
                operations: json(validated.data),
                configuration: json(configuration),
                configurationHash: contentHash(configuration),
                refinementText: input.refinement,
                createdBy: ctx.principal.subjectId,
              },
            });
            await tx.revisionLifecycle.update({
              where: { revisionId: parent.id },
              data: { state: 'Superseded', lockVersion: { increment: 1 } },
            });
            await tx.revisionLifecycle.create({
              data: { revisionId, ...scope, state: 'ReadyForPreview' },
            });
            await tx.proposal.update({
              where: { id: proposalId },
              data: { currentRevisionId: revisionId },
            });
            await this.validation(tx, ctx, revision, 'refinement');
            await this.audit(tx, ctx, 'RevisionCreated', scope.pageId, revisionId, {
              parentRevisionId: parent.id,
            });
            return this.envelope(tx, ctx, revisionId);
          }),
        { timeout: 15000 },
      ),
    );
  }
  private jobEnvelope(job: PlannerJob): PlannerJobEnvelope {
    return {
      jobId: job.id,
      requestId: job.requestId,
      proposalId: job.proposalId,
      status: job.status as PlannerJobStatus,
      attempts: job.attempts,
      resultCode: job.resultCode,
      message: job.message,
      revisionId: job.revisionId,
      createdAt: job.createdAt.toISOString(),
    };
  }
  private plannerInput(
    pageId: string,
    request: string,
    base: TableConfiguration,
    previousOperations?: PlannerInput['previousOperations'],
    originalRequest?: string,
  ): PlannerInput {
    const page = this.page(pageId);
    return {
      request,
      page: {
        pageId,
        fields: page.fields,
        operations: page.operations,
        ...(page.actions ? { actions: page.actions } : {}),
        ...(page.features ? { features: page.features } : {}),
      },
      baseConfiguration: base,
      ...(previousOperations ? { previousOperations } : {}),
      ...(originalRequest ? { originalRequest } : {}),
    };
  }
  private async plannerLimit(tx: Tx, ctx: ActionContext) {
    const scope = {
      applicationId: ctx.principal.applicationId,
      tenantId: ctx.principal.tenantId,
      requesterId: ctx.principal.subjectId,
    };
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalize({ plannerLimit: scope })}, 0))::text AS locked`;
    const recent = await tx.plannerJob.count({
      where: { ...scope, createdAt: { gte: new Date(Date.now() - 60000) } },
    });
    const pending = await tx.plannerJob.count({
      where: { ...scope, status: { in: ['Queued', 'Running'] } },
    });
    if (recent >= 10 || pending >= 3)
      throw new EvolutionError(
        429,
        'PLANNER_RATE_LIMIT',
        'Too many proposal requests. Wait a minute and try again.',
      );
  }
  async enqueueRequest(
    ctx: ActionContext,
    input: WriteInput & { pageId: string; text: string; expectedGeneration: number },
  ) {
    const scope = this.scope(ctx, input.pageId);
    await this.allow(ctx, 'evolution:request', scope);
    return this.db.$transaction(
      (tx) =>
        this.idempotent(tx, ctx, 'planner-request', input, async () => {
          await this.plannerLimit(tx, ctx);
          const active = await this.lockActive(tx, scope);
          await this.allow(ctx, 'evolution:request', scope);
          if (active.generation !== BigInt(input.expectedGeneration))
            conflict('Active configuration changed. Refresh before generating.');
          await this.compatible(tx, scope.applicationId, this.registryVersionId);
          const base =
            (await tx.configurationVersion.findFirst({
              where: { id: active.versionId, ...scope },
            })) ?? notFound();
          const requestId = randomUUID(),
            proposalId = randomUUID();
          await tx.evolutionRequest.create({
            data: {
              id: requestId,
              ...scope,
              requesterId: ctx.principal.subjectId,
              text: input.text,
            },
          });
          await tx.proposal.create({ data: { id: proposalId, ...scope, requestId } });
          const job = await tx.plannerJob.create({
            data: {
              id: randomUUID(),
              ...scope,
              requestId,
              proposalId,
              requesterId: ctx.principal.subjectId,
              correlationId: ctx.correlationId,
              registryVersionId: this.registryVersionId,
              baseVersionId: active.versionId,
              baseGeneration: active.generation,
              input: json(
                this.plannerInput(
                  input.pageId,
                  input.text,
                  this.validateStored(base.configuration, input.pageId, base.configurationHash),
                ),
              ),
            },
          });
          await this.audit(tx, ctx, 'PlannerQueued', scope.pageId, job.id);
          return this.jobEnvelope(job);
        }),
      { timeout: 15000 },
    );
  }
  async enqueueRefinement(
    ctx: ActionContext,
    proposalId: string,
    input: WriteInput & {
      parentRevisionId: string;
      expectedLockVersion: number;
      refinement: string;
    },
  ) {
    const loaded = await this.proposal(this.db, ctx, proposalId),
      scope = this.scope(ctx, loaded.pageId);
    await this.allow(ctx, 'evolution:refine', { ...scope, requesterId: loaded.requesterId });
    return this.db.$transaction(
      (tx) =>
        this.idempotent(tx, ctx, `planner-refine:${proposalId}`, input, async () => {
          await this.plannerLimit(tx, ctx);
          const proposal = await this.proposal(tx, ctx, proposalId, true);
          await this.allow(ctx, 'evolution:refine', {
            ...scope,
            requesterId: proposal.requesterId,
          });
          const parent = await this.revision(tx, ctx, input.parentRevisionId);
          const lifecycle = await tx.revisionLifecycle.findUnique({
            where: { revisionId: parent.id },
          });
          if (
            proposal.currentRevisionId !== parent.id ||
            parent.proposalId !== proposalId ||
            lifecycle?.lockVersion !== input.expectedLockVersion ||
            !['ReadyForPreview', 'PendingApproval', 'Approved'].includes(lifecycle.state)
          )
            conflict('The revision changed or cannot be refined. Refresh before generating.');
          await this.compatible(tx, scope.applicationId, parent.registryVersionId);
          const base =
            (await tx.configurationVersion.findFirst({
              where: { id: parent.baseVersionId, ...scope },
            })) ?? notFound();
          const job = await tx.plannerJob.create({
            data: {
              id: randomUUID(),
              ...scope,
              requestId: proposal.requestId,
              proposalId,
              parentRevisionId: parent.id,
              expectedLockVersion: input.expectedLockVersion,
              requesterId: ctx.principal.subjectId,
              correlationId: ctx.correlationId,
              registryVersionId: this.registryVersionId,
              baseVersionId: parent.baseVersionId,
              baseGeneration: parent.baseGeneration,
              input: json(
                this.plannerInput(
                  scope.pageId,
                  input.refinement,
                  this.validateStored(base.configuration, scope.pageId, base.configurationHash),
                  parent.operations as unknown as PlannerInput['previousOperations'],
                  proposal.text,
                ),
              ),
            },
          });
          await this.audit(tx, ctx, 'PlannerQueued', scope.pageId, job.id, {
            parentRevisionId: parent.id,
          });
          return this.jobEnvelope(job);
        }),
      { timeout: 15000 },
    );
  }
  async getPlannerJob(ctx: ActionContext, jobId: string) {
    const job =
      (await this.db.plannerJob.findFirst({
        where: {
          id: jobId,
          applicationId: ctx.principal.applicationId,
          tenantId: ctx.principal.tenantId,
        },
      })) ?? notFound();
    const proposal = await this.proposal(this.db, ctx, job.proposalId);
    await this.allow(ctx, 'evolution:read', {
      ...this.scope(ctx, job.pageId),
      requesterId: proposal.requesterId,
    });
    return this.jobEnvelope(job);
  }
  async listPlannerJobs(ctx: ActionContext, pageId: string) {
    const scope = this.scope(ctx, pageId);
    await this.allow(ctx, 'evolution:read', scope);
    const jobs = await this.db.plannerJob.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const visible: PlannerJobEnvelope[] = [];
    for (const job of jobs) {
      const proposal = await this.proposal(this.db, ctx, job.proposalId);
      if (
        await this.authorization.authorize(ctx.principal, 'evolution:read', {
          ...scope,
          requesterId: proposal.requesterId,
        })
      )
        visible.push(this.jobEnvelope(job));
    }
    return visible;
  }
  private jobContext(job: PlannerJob): ActionContext {
    return {
      principal: {
        applicationId: job.applicationId,
        tenantId: job.tenantId,
        subjectId: job.requesterId,
      },
      correlationId: job.correlationId,
    };
  }
  private async finishJob(
    tx: Tx,
    job: PlannerJob,
    status: PlannerJobStatus,
    resultCode: string,
    message: string,
    revisionId?: string,
  ) {
    await tx.plannerJob.update({
      where: { id: job.id },
      data: {
        status,
        resultCode,
        message,
        revisionId,
        completedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    await this.audit(tx, this.jobContext(job), `Planner${status}`, job.pageId, job.id, {
      resultCode,
      attempts: job.attempts,
      ...(revisionId ? { revisionId } : {}),
    });
  }
  /** Lease exactly one job. External generation runs outside any database transaction. */
  async runPlannerOnce(
    provider: PlannerProvider,
    options: { timeoutMs?: number; retryDelayMs?: number; signal?: AbortSignal } = {},
  ): Promise<boolean> {
    const timeoutMs = options.timeoutMs ?? 60000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new Error('Planner timeout must be 1–60000 ms.');
    if (
      options.retryDelayMs !== undefined &&
      (!Number.isFinite(options.retryDelayMs) ||
        options.retryDelayMs < 0 ||
        options.retryDelayMs > 60000)
    )
      throw new Error('Planner retry delay must be 0–60000 ms.');
    if (options.signal?.aborted) return false;
    const leaseToken = randomUUID();
    const job = await this.db.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<
        PlannerJob[]
      >`SELECT * FROM "PlannerJob" WHERE "applicationId"=${this.registry.applicationId} AND status='Running' AND "leaseUntil"<=NOW() AND attempts>=3 FOR UPDATE SKIP LOCKED LIMIT 10`;
      for (const expiredJob of expired)
        await this.finishJob(
          tx,
          expiredJob,
          'Failed',
          'LEASE_EXHAUSTED',
          'Generation did not finish after three attempts. Start a new request.',
        );
      const jobs = await tx.$queryRaw<PlannerJob[]>`WITH candidate AS (
        SELECT id FROM "PlannerJob" WHERE "applicationId"=${this.registry.applicationId} AND attempts<3 AND
        ((status='Queued' AND "availableAt"<=NOW()) OR (status='Running' AND "leaseUntil"<=NOW()))
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE "PlannerJob" j SET status='Running', attempts=attempts+1, "leaseToken"=${leaseToken}, "leaseUntil"=NOW()+(${timeoutMs + 15000} * INTERVAL '1 millisecond')
        FROM candidate WHERE j.id=candidate.id RETURNING j.*`;
      return jobs[0] ?? null;
    });
    if (!job) return false;
    const ctx = this.jobContext(job);
    let candidate: ReturnType<typeof parseCandidate> | undefined;
    let failure: unknown;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const owner = await this.proposal(this.db, ctx, job.proposalId);
      await this.allow(ctx, job.parentRevisionId ? 'evolution:refine' : 'evolution:request', {
        ...this.scope(ctx, job.pageId),
        requesterId: owner.requesterId,
      });
      candidate = parseCandidate(
        await Promise.race([
          Promise.resolve().then(() =>
            provider.generate(job.input as unknown as PlannerInput, controller.signal),
          ),
          new Promise<never>((_, reject) => {
            const timeout = () => {
              controller.abort();
              reject(new PlannerError('PLANNER_TIMEOUT', true));
            };
            timer = setTimeout(timeout, timeoutMs);
            controller.signal.addEventListener(
              'abort',
              () => reject(new PlannerError('PLANNER_TIMEOUT', true)),
              { once: true },
            );
            if (controller.signal.aborted) timeout();
          }),
        ]),
      );
    } catch (error) {
      failure = error;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
    // Proposal lock first: refinement/publication use the same order. Lease token fences stale workers.
    await this.db.$transaction(
      async (tx) => {
        const proposal = await this.proposal(tx, ctx, job.proposalId, true);
        const leased = await tx.$queryRaw<
          PlannerJob[]
        >`SELECT * FROM "PlannerJob" WHERE id=${job.id} AND status='Running' AND "leaseToken"=${leaseToken} AND "leaseUntil">NOW() FOR UPDATE`;
        if (!leased.length) return;
        const currentJob = leased[0];
        if (failure) {
          const error = failure instanceof PlannerError ? failure : undefined;
          if (error?.retryable && job.attempts < 3) {
            await tx.plannerJob.update({
              where: { id: job.id },
              data: {
                status: 'Queued',
                leaseToken: null,
                leaseUntil: null,
                availableAt: new Date(Date.now() + (options.retryDelayMs ?? job.attempts * 5000)),
                resultCode: error.code,
                message: 'Provider unavailable. A bounded retry is queued.',
              },
            });
            await this.audit(tx, ctx, 'PlannerRetryQueued', job.pageId, job.id, {
              resultCode: error.code,
              attempts: job.attempts,
            });
          } else
            await this.finishJob(
              tx,
              currentJob,
              'Failed',
              error?.code ?? (failure instanceof EvolutionError ? failure.code : 'PROVIDER_ERROR'),
              'Generation could not complete. Check planner configuration or start a new request.',
            );
          return;
        }
        try {
          await this.allow(ctx, job.parentRevisionId ? 'evolution:refine' : 'evolution:request', {
            ...this.scope(ctx, job.pageId),
            requesterId: proposal.requesterId,
          });
          await this.compatible(tx, job.applicationId, job.registryVersionId);
          if (proposal.currentRevisionId !== job.parentRevisionId)
            conflict('The proposal changed during generation.');
          const parent = job.parentRevisionId
            ? await this.revision(tx, ctx, job.parentRevisionId)
            : null;
          if (parent) {
            const lifecycle = await tx.revisionLifecycle.findUnique({
              where: { revisionId: parent.id },
            });
            if (
              lifecycle?.lockVersion !== job.expectedLockVersion ||
              !['ReadyForPreview', 'PendingApproval', 'Approved'].includes(lifecycle.state)
            )
              conflict('The revision changed during generation.');
          }
          if (!candidate) throw new PlannerError('INVALID_CANDIDATE');
          if (candidate.kind !== 'runtime') {
            await this.finishJob(
              tx,
              currentJob,
              candidate.kind === 'unsupported' ? 'Unsupported' : 'NeedsClarification',
              candidate.kind === 'unsupported' ? 'UNSUPPORTED_REQUEST' : 'NEEDS_CLARIFICATION',
              candidate.reason,
            );
            return;
          }
          const base =
            (await tx.configurationVersion.findFirst({
              where: {
                id: job.baseVersionId,
                applicationId: job.applicationId,
                tenantId: job.tenantId,
                pageId: job.pageId,
              },
            })) ?? notFound();
          const pinnedRegistry =
            job.registryVersionId === this.registryVersionId
              ? this.registry
              : this.compatibleRegistries.get(job.registryVersionId);
          const pinnedPage =
            pinnedRegistry?.pages.find((page) => page.pageId === job.pageId) ?? notFound();
          const checked = validateOperations(candidate.operations, pinnedPage);
          if (!checked.success) throw new ConfigurationError(checked.errors);
          const configuration = applyOperations(
            this.validateStored(base.configuration, job.pageId, base.configurationHash),
            checked.data,
            pinnedPage,
          );
          const revisionId = randomUUID(),
            scope = this.scope(ctx, job.pageId);
          // All possible validation failures happen before the first content write.
          const revision = await tx.proposalRevision.create({
            data: {
              id: revisionId,
              ...scope,
              proposalId: proposal.id,
              revisionNumber: (parent?.revisionNumber ?? 0) + 1,
              parentRevisionId: parent?.id,
              registryVersionId: job.registryVersionId,
              baseVersionId: job.baseVersionId,
              baseGeneration: job.baseGeneration,
              operations: json(checked.data),
              configuration: json(configuration),
              configurationHash: contentHash(configuration),
              refinementText: parent ? (job.input as unknown as PlannerInput).request : '',
              createdBy: job.requesterId,
            },
          });
          if (parent)
            await tx.revisionLifecycle.update({
              where: { revisionId: parent.id },
              data: { state: 'Superseded', lockVersion: { increment: 1 } },
            });
          await tx.revisionLifecycle.create({
            data: { revisionId, ...scope, state: 'ReadyForPreview' },
          });
          await tx.proposal.update({
            where: { id: proposal.id },
            data: { currentRevisionId: revisionId },
          });
          await this.validation(tx, ctx, revision, 'planner');
          await this.finishJob(
            tx,
            currentJob,
            'Succeeded',
            'VALIDATED',
            candidate.summary,
            revisionId,
          );
        } catch (error) {
          // Database write failures must roll back the transaction; only pre-write domain failures are terminal job results.
          if (
            !(
              error instanceof ConfigurationError ||
              error instanceof EvolutionError ||
              error instanceof PlannerError
            )
          )
            throw error;
          await this.finishJob(
            tx,
            currentJob,
            'Failed',
            error instanceof ConfigurationError ? 'INVALID_CONFIGURATION' : error.code,
            error instanceof ConfigurationError
              ? 'Generated operations did not pass capability validation. Start a new request.'
              : 'The proposal or permission changed during generation. Refresh before trying again.',
          );
        }
      },
      { timeout: 15000 },
    );
    return true;
  }
  private async reviewAction(
    ctx: ActionContext,
    proposalId: string,
    input: RevisionAction & { reason?: string },
    action: 'submit' | 'approve' | 'reject',
  ) {
    const loaded = await this.proposal(this.db, ctx, proposalId);
    await this.allow(ctx, action === 'submit' ? 'evolution:submit' : 'evolution:approve', {
      ...this.scope(ctx, loaded.pageId),
      requesterId: loaded.requesterId,
    });
    return this.guard(ctx, loaded.pageId, () =>
      this.db.$transaction(async (tx) => {
        const proposal = await this.proposal(tx, ctx, proposalId, true);
        await this.allow(ctx, action === 'submit' ? 'evolution:submit' : 'evolution:approve', {
          ...this.scope(ctx, proposal.pageId),
          requesterId: proposal.requesterId,
        });
        if (proposal.currentRevisionId !== input.revisionId)
          conflict('Approval must refer to the current immutable revision.');
        const revision = await this.revision(tx, ctx, input.revisionId);
        const lifecycle =
          (await tx.revisionLifecycle.findUnique({ where: { revisionId: revision.id } })) ??
          notFound();
        if (
          lifecycle.state !== (action === 'submit' ? 'ReadyForPreview' : 'PendingApproval') ||
          lifecycle.lockVersion !== input.expectedLockVersion
        )
          conflict('Proposal state changed. Refresh and review it again.');
        if (revision.configurationHash !== input.configurationHash)
          conflict('The revision hash does not match.');
        this.validateStored(revision.configuration, revision.pageId, revision.configurationHash);
        await this.validation(tx, ctx, revision, action);
        if (action !== 'submit')
          await tx.approval.create({
            data: {
              id: randomUUID(),
              ...this.scope(ctx, revision.pageId),
              revisionId: revision.id,
              configurationHash: revision.configurationHash,
              decision: action,
              actorId: ctx.principal.subjectId,
              reason: input.reason,
            },
          });
        const state =
          action === 'submit' ? 'PendingApproval' : action === 'approve' ? 'Approved' : 'Rejected';
        await tx.revisionLifecycle.update({
          where: { revisionId: revision.id },
          data: { state, lockVersion: { increment: 1 } },
        });
        await this.audit(tx, ctx, state, revision.pageId, revision.id);
        return this.envelope(tx, ctx, revision.id);
      }),
    );
  }
  submit(ctx: ActionContext, proposalId: string, input: RevisionAction) {
    return this.reviewAction(ctx, proposalId, input, 'submit');
  }
  approve(ctx: ActionContext, proposalId: string, input: RevisionAction) {
    return this.reviewAction(ctx, proposalId, input, 'approve');
  }
  reject(ctx: ActionContext, proposalId: string, input: RevisionAction & { reason?: string }) {
    return this.reviewAction(ctx, proposalId, input, 'reject');
  }
  async publish(
    ctx: ActionContext,
    input: WriteInput & { revisionId: string; expectedGeneration: number },
  ): Promise<ConfigurationEnvelope> {
    const loaded = await this.revision(this.db, ctx, input.revisionId),
      scope = this.scope(ctx, loaded.pageId);
    await this.allow(ctx, 'evolution:publish', scope);
    const result = await this.guard(ctx, loaded.pageId, () =>
      this.db.$transaction(
        (tx) =>
          this.idempotent(tx, ctx, 'publish', input, async () => {
            const proposal = await this.proposal(tx, ctx, loaded.proposalId, true),
              revision = await this.revision(tx, ctx, input.revisionId);
            const lifecycle =
              (await tx.revisionLifecycle.findUnique({ where: { revisionId: revision.id } })) ??
              notFound();
            if (proposal.currentRevisionId !== revision.id || lifecycle.state !== 'Approved')
              conflict('Only the current approved revision can be published.');
            const approval = await tx.approval.findUnique({ where: { revisionId: revision.id } });
            if (
              !approval ||
              approval.decision !== 'approve' ||
              approval.configurationHash !== revision.configurationHash
            )
              conflict('Approval does not match this revision.');
            await this.compatible(tx, scope.applicationId, revision.registryVersionId);
            const configuration = this.validateStored(
              revision.configuration,
              scope.pageId,
              revision.configurationHash,
            );
            await this.validation(tx, ctx, revision, 'publication');
            const active = await this.lockActive(tx, scope);
            await this.allow(ctx, 'evolution:publish', scope);
            if (
              active.generation !== BigInt(input.expectedGeneration) ||
              active.generation !== revision.baseGeneration ||
              active.versionId !== revision.baseVersionId
            ) {
              await tx.revisionLifecycle.update({
                where: { revisionId: revision.id },
                data: { state: 'PublicationConflict', lockVersion: { increment: 1 } },
              });
              await this.audit(tx, ctx, 'PublicationConflict', scope.pageId, revision.id, {
                generation: Number(active.generation),
              });
              return { publicationConflict: true as const };
            }
            const versionId = randomUUID(),
              generation = active.generation + 1n;
            await tx.configurationVersion.create({
              data: {
                id: versionId,
                ...scope,
                registryVersionId: revision.registryVersionId,
                parentVersionId: active.versionId,
                sourceRevisionId: revision.id,
                configuration: json(configuration),
                configurationHash: revision.configurationHash,
                createdBy: ctx.principal.subjectId,
              },
            });
            await tx.activeConfiguration.update({
              where: { applicationId_tenantId_pageId: scope },
              data: { versionId, generation },
            });
            await tx.activationEvent.create({
              data: {
                id: randomUUID(),
                ...scope,
                generation,
                previousVersionId: active.versionId,
                versionId,
                kind: 'publish',
                approvalId: approval.id,
                actorId: ctx.principal.subjectId,
              },
            });
            await tx.revisionLifecycle.update({
              where: { revisionId: revision.id },
              data: { state: 'Published', lockVersion: { increment: 1 } },
            });
            await this.audit(tx, ctx, 'Published', scope.pageId, versionId, {
              revisionId: revision.id,
              generation: Number(generation),
            });
            return this.configEnvelope(tx, scope);
          }),
        { timeout: 15000 },
      ),
    );
    if ('publicationConflict' in result)
      throw new EvolutionError(
        409,
        'PUBLICATION_CONFLICT',
        'Active configuration changed. Create a new proposal and obtain approval again.',
      );
    return result;
  }
  async rollback(
    ctx: ActionContext,
    input: WriteInput & {
      pageId: string;
      targetVersionId: string;
      expectedGeneration: number;
      reason: string;
    },
  ) {
    const scope = this.scope(ctx, input.pageId);
    await this.allow(ctx, 'evolution:rollback', scope);
    return this.guard(ctx, input.pageId, () =>
      this.db.$transaction(
        (tx) =>
          this.idempotent(tx, ctx, 'rollback', input, async () => {
            const target =
              (await tx.configurationVersion.findFirst({
                where: { id: input.targetVersionId, ...scope },
              })) ?? notFound();
            await this.compatible(tx, scope.applicationId, target.registryVersionId);
            this.validateStored(target.configuration, scope.pageId, target.configurationHash);
            const active = await this.lockActive(tx, scope);
            await this.allow(ctx, 'evolution:rollback', scope);
            if (active.generation !== BigInt(input.expectedGeneration))
              conflict('Active configuration changed. Refresh before rolling back.');
            if (active.versionId === target.id) return this.configEnvelope(tx, scope);
            const old =
              (await tx.configurationVersion.findFirst({
                where: { id: active.versionId, ...scope },
              })) ?? notFound();
            const generation = active.generation + 1n;
            await tx.activeConfiguration.update({
              where: { applicationId_tenantId_pageId: scope },
              data: { versionId: target.id, generation },
            });
            await tx.activationEvent.create({
              data: {
                id: randomUUID(),
                ...scope,
                generation,
                previousVersionId: active.versionId,
                versionId: target.id,
                kind: 'rollback',
                actorId: ctx.principal.subjectId,
                reason: input.reason,
              },
            });
            if (old.sourceRevisionId)
              await tx.revisionLifecycle.updateMany({
                where: { revisionId: old.sourceRevisionId, state: 'Published' },
                data: { state: 'RolledBack', lockVersion: { increment: 1 } },
              });
            await this.audit(tx, ctx, 'RolledBack', scope.pageId, target.id, {
              previousVersionId: old.id,
              generation: Number(generation),
            });
            return this.configEnvelope(tx, scope);
          }),
        { timeout: 15000 },
      ),
    );
  }
  async history(ctx: ActionContext, pageId: string): Promise<ConfigurationHistory> {
    const scope = this.scope(ctx, pageId);
    await this.allow(ctx, 'evolution:read', scope);
    const [versions, activations] = await Promise.all([
      this.db.configurationVersion.findMany({
        where: scope,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.activationEvent.findMany({ where: scope, orderBy: { generation: 'desc' }, take: 50 }),
    ]);
    return {
      versions: versions.map((v) => ({
        versionId: v.id,
        parentVersionId: v.parentVersionId,
        sourceRevisionId: v.sourceRevisionId,
        configurationHash: v.configurationHash,
        actorId: v.createdBy,
        createdAt: v.createdAt.toISOString(),
      })),
      activations: activations.map((e) => ({
        id: e.id,
        generation: Number(e.generation),
        kind: e.kind as 'baseline' | 'publish' | 'rollback',
        versionId: e.versionId,
        previousVersionId: e.previousVersionId,
        actorId: e.actorId,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
  async auditEvents(ctx: ActionContext, pageId: string) {
    const scope = this.scope(ctx, pageId);
    await this.allow(ctx, 'evolution:audit', scope);
    return this.db.auditEvent.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
