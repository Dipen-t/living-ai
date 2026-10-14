import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import type { PrismaClient, Prisma, CodeProposal } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DemoSession, Permission } from '@evolvekit/core';
import {
  toolRecordSchema,
  toolCasesSchema,
  matchesToolContract,
  type ToolRecord,
  toolBindingSchema,
  toolManualInputSchema,
  validateToolBinding,
  resolveToolInput,
  toolReviewContent,
} from '@evolvekit/core';
import { toolDataSources, toolDataSource, toolDataChoices, toolDataRow } from './tool-data';
import { EvolutionError, contentHash } from '@evolvekit/server';
import { z } from 'zod';

const casesSchema = toolCasesSchema;
const createSchema = z
  .object({
    request: z.string().trim().min(1).max(4000),
    cases: casesSchema,
    binding: toolBindingSchema.optional(),
  })
  .strict();
const actionSchema = z
  .object({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
const idSchema = z.object({ id: z.string().uuid() }).strict();
type Cases = z.infer<typeof casesSchema>;
type Draft = {
  featureId: string;
  summary: string;
  files: Record<'logic.ts' | 'Feature.tsx', string>;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const git = promisify(execFile);
function bindingValidation<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof EvolutionError || error instanceof z.ZodError) throw error;
    throw new EvolutionError(
      422,
      'INPUT_MAPPING',
      error instanceof Error ? error.message : 'Check the workspace input mapping.',
    );
  }
}
export interface CodeEngine {
  baseCommit(): Promise<string>;
  generate(
    request: string,
    cases: Cases,
  ): Promise<{ draft: Draft; report: { passed: number; preview: string } }>;
  evaluate(
    draft: Draft,
    cases: Cases,
    request: string,
    input: ToolRecord,
  ): Promise<{ result: ToolRecord; preview: string }>;
}
export function createCodeEngine(): CodeEngine {
  const load = async () =>
    await import(pathToFileURL(path.join(workspace, 'tools/code-evolution.mjs')).href);
  return {
    async baseCommit() {
      const { stdout } = await git('git', ['rev-parse', 'HEAD'], {
        cwd: workspace,
        windowsHide: true,
      });
      const value = stdout.trim();
      if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('Repository needs a base commit.');
      return value;
    },
    async generate(request, cases) {
      const tool = await load();
      const draft = await tool.generateDraft(request, cases);
      const staged = await tool.stageDraft(draft, cases, request);
      await tool.verifyDraft(staged.directory, staged.manifest);
      const { readFile } = await import('node:fs/promises');
      const report = JSON.parse(await readFile(path.join(staged.directory, 'report.json'), 'utf8'));
      return { draft, report };
    },
    async evaluate(draft, cases, request, input) {
      const tool = await load();
      tool.validateDraft(draft);
      const staged = await tool.stageDraft(draft, cases, request);
      await tool.compileDraft(staged.directory);
      return await tool.testDraft(staged.directory, input);
    },
  };
}
export async function registerCodeRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  session: (request: FastifyRequest) => DemoSession,
  supplied?: CodeEngine,
  runWorker = true,
) {
  const engine = supplied ?? createCodeEngine();
  const scope = (identity: DemoSession) => ({
    applicationId: identity.principal.applicationId,
    tenantId: identity.principal.tenantId,
  });
  const allow = (request: FastifyRequest, permission: Permission) => {
    const identity = session(request);
    if (!identity.permissions.includes(permission))
      throw new EvolutionError(403, 'FORBIDDEN', 'Your account cannot perform this action.');
    return identity;
  };
  const audit = (
    tx: Prisma.TransactionClient,
    identity: DemoSession,
    eventType: string,
    resourceId: string | null,
    metadata: unknown,
  ) =>
    tx.auditEvent.create({
      data: {
        id: randomUUID(),
        ...scope(identity),
        actorId: identity.principal.subjectId,
        eventType,
        resourceId,
        correlationId: randomUUID(),
        metadata: json(metadata),
      },
    });
  const find = async (identity: DemoSession, id: string, tx: Prisma.TransactionClient = db) => {
    const proposal = await tx.codeProposal.findFirst({ where: { ...scope(identity), id } });
    if (!proposal) throw new EvolutionError(404, 'NOT_FOUND', 'Calculator draft not found.');
    return proposal;
  };
  const verify = (p: CodeProposal) => {
    if (
      !p.source ||
      !p.contentHash ||
      p.contentHash !== contentHash(toolReviewContent(p.source, p.cases, p.request, p.binding))
    )
      throw new EvolutionError(409, 'CONTENT_CHANGED', 'The source no longer matches this draft.');
  };
  const pointer = async (identity: DemoSession, tx: Prisma.TransactionClient = db) =>
    tx.codeActive.upsert({
      where: { applicationId_tenantId: scope(identity) },
      create: scope(identity),
      update: {},
    });
  app.get('/v1/code-proposals', async (request) => {
    const identity = allow(request, 'code:read');
    const proposals = await db.codeProposal.findMany({
      where: scope(identity),
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const reviews = await db.auditEvent.findMany({
      where: {
        ...scope(identity),
        eventType: 'CodePullRequest',
        resourceId: { in: proposals.map((p) => p.id) },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      proposals: proposals.map((p) => {
        const metadata = reviews.find((event) => event.resourceId === p.id)?.metadata as
          | { url?: string; contentHash?: string }
          | undefined;
        const reviewUrl =
          metadata?.contentHash === p.contentHash &&
          /^https:\/\/github\.com\/Dipen-t\/living-ai\/pull\/[1-9][0-9]*$/i.test(
            metadata?.url ?? '',
          )
            ? metadata!.url
            : null;
        return { ...p, reviewUrl };
      }),
      active: await pointer(identity),
      releases: await db.codeRelease.findMany({
        where: scope(identity),
        orderBy: { generation: 'desc' },
        take: 30,
      }),
    };
  });
  app.post('/v1/code-proposals', async (request, reply) => {
    const identity = allow(request, 'code:request');
    const input = createSchema.parse(request.body);
    if (input.binding)
      bindingValidation(() =>
        validateToolBinding(
          input.binding!,
          input.cases[0].input,
          toolDataSource(identity, input.binding!.sourceId),
        ),
      );
    const key = z.string().uuid().parse(request.headers['idempotency-key']);
    const baseCommit = await engine.baseCommit();
    const proposal = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${identity.principal.applicationId}:${identity.principal.tenantId}:code-create`}))`;
      const where = {
        ...scope(identity),
        actorId: identity.principal.subjectId,
        routeKey: 'code:create',
        key,
      };
      const previous = await tx.idempotencyKey.findUnique({
        where: { applicationId_tenantId_actorId_routeKey_key: where },
      });
      if (previous) {
        if (previous.requestHash !== contentHash(input))
          throw new EvolutionError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Start a new request for different calculator details.',
          );
        return await find(identity, (previous.response as { id: string }).id, tx);
      }
      const pending = await tx.codeProposal.count({
        where: { ...scope(identity), state: { in: ['Queued', 'Generating'] } },
      });
      if (pending >= 2)
        throw new EvolutionError(429, 'BUSY', 'Wait for your current calculator drafts to finish.');
      const active = await pointer(identity, tx);
      const created = await tx.codeProposal.create({
        data: {
          ...(input.binding ? { binding: json(input.binding) } : {}),
          id: randomUUID(),
          ...scope(identity),
          requesterId: identity.principal.subjectId,
          request: input.request,
          cases: json(input.cases),
          baseGeneration: active.generation,
          baseCommit,
        },
      });
      await tx.idempotencyKey.create({
        data: { ...where, requestHash: contentHash(input), response: { id: created.id } },
      });
      await audit(tx, identity, 'CodeRequested', created.id, {
        baseCommit,
        baseGeneration: active.generation,
      });
      return created;
    });
    return reply.code(202).send(proposal);
  });
  for (const operation of ['submit', 'approve'] as const)
    app.post(`/v1/code-proposals/:id/${operation}`, async (request) => {
      const identity = allow(request, operation === 'submit' ? 'code:submit' : 'code:approve');
      const { id } = idSchema.parse(request.params),
        input = actionSchema.parse(request.body);
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "CodeProposal" WHERE "id"=${id} AND "applicationId"=${identity.principal.applicationId} AND "tenantId"=${identity.principal.tenantId} FOR UPDATE`;
        const p = await find(identity, id, tx);
        verify(p);
        if (
          p.contentHash !== input.contentHash ||
          p.lockVersion !== input.expectedVersion ||
          p.state !== (operation === 'submit' ? 'Ready' : 'PendingApproval')
        )
          throw new EvolutionError(409, 'STALE_DRAFT', 'Refresh this draft before continuing.');
        if (
          (operation === 'submit' && p.requesterId !== identity.principal.subjectId) ||
          (operation === 'approve' && p.requesterId === identity.principal.subjectId)
        )
          throw new EvolutionError(
            403,
            'FORBIDDEN',
            'A separate reviewer must approve this exact code.',
          );
        if (operation === 'approve')
          await tx.codeApproval.create({
            data: {
              id: randomUUID(),
              ...scope(identity),
              proposalId: id,
              contentHash: p.contentHash!,
              reviewerId: identity.principal.subjectId,
            },
          });
        const updated = await tx.codeProposal.update({
          where: { id },
          data: {
            state: operation === 'submit' ? 'PendingApproval' : 'Approved',
            lockVersion: { increment: 1 },
          },
        });
        await audit(tx, identity, operation === 'submit' ? 'CodeSubmitted' : 'CodeApproved', id, {
          contentHash: p.contentHash,
        });
        return updated;
      });
    });
  app.post('/v1/code-proposals/:id/activate', async (request) => {
    const identity = allow(request, 'code:activate');
    const { id } = idSchema.parse(request.params);
    const input = actionSchema
      .extend({ expectedGeneration: z.number().int().nonnegative() })
      .parse(request.body);
    const baseCommit = await engine.baseCommit();
    return await db.$transaction(async (tx) => {
      await pointer(identity, tx);
      await tx.$queryRaw`SELECT "generation" FROM "CodeActive" WHERE "applicationId"=${identity.principal.applicationId} AND "tenantId"=${identity.principal.tenantId} FOR UPDATE`;
      const active = await pointer(identity, tx);
      await tx.$queryRaw`SELECT "id" FROM "CodeProposal" WHERE "id"=${id} AND "applicationId"=${identity.principal.applicationId} AND "tenantId"=${identity.principal.tenantId} FOR UPDATE`;
      const p = await find(identity, id, tx);
      verify(p);
      const approval = await tx.codeApproval.findUnique({ where: { proposalId: id } });
      if (p.binding) {
        const binding = toolBindingSchema.parse(p.binding);
        bindingValidation(() =>
          validateToolBinding(
            binding,
            (p.cases as Cases)[0].input,
            toolDataSource(identity, binding.sourceId),
          ),
        );
      }
      if (
        p.state !== 'Approved' ||
        p.lockVersion !== input.expectedVersion ||
        p.contentHash !== input.contentHash ||
        approval?.contentHash !== p.contentHash ||
        p.baseCommit !== baseCommit ||
        active.generation !== input.expectedGeneration ||
        p.baseGeneration !== active.generation
      )
        throw new EvolutionError(
          409,
          'PUBLICATION_CONFLICT',
          'The draft or workspace changed. Create a new preview before activation.',
        );
      const next = await tx.codeActive.update({
        where: { applicationId_tenantId: scope(identity) },
        data: { proposalId: id, generation: { increment: 1 } },
      });
      await tx.codeRelease.create({
        data: {
          id: randomUUID(),
          ...scope(identity),
          proposalId: id,
          previousProposalId: active.proposalId,
          generation: next.generation,
          kind: 'Activate',
          actorId: identity.principal.subjectId,
        },
      });
      await tx.codeProposal.update({
        where: { id },
        data: { state: 'Published', lockVersion: { increment: 1 } },
      });
      await audit(tx, identity, 'CodeActivated', id, {
        contentHash: p.contentHash,
        generation: next.generation,
        baseCommit,
      });
      return next;
    });
  });
  app.post('/v1/code-rollback', async (request) => {
    const identity = allow(request, 'code:rollback');
    const input = z
      .object({ expectedGeneration: z.number().int().nonnegative(), releaseId: z.string().uuid() })
      .strict()
      .parse(request.body);
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "generation" FROM "CodeActive" WHERE "applicationId"=${identity.principal.applicationId} AND "tenantId"=${identity.principal.tenantId} FOR UPDATE`;
      const active = await pointer(identity, tx);
      const release = await tx.codeRelease.findFirst({
        where: { ...scope(identity), id: input.releaseId, generation: active.generation },
      });
      if (!release || active.generation !== input.expectedGeneration)
        throw new EvolutionError(
          409,
          'STALE_RELEASE',
          'Refresh the active calculator before restoring it.',
        );
      if (release.previousProposalId) verify(await find(identity, release.previousProposalId, tx));
      const next = await tx.codeActive.update({
        where: { applicationId_tenantId: scope(identity) },
        data: { proposalId: release.previousProposalId, generation: { increment: 1 } },
      });
      await tx.codeRelease.create({
        data: {
          id: randomUUID(),
          ...scope(identity),
          proposalId: next.proposalId,
          previousProposalId: active.proposalId,
          generation: next.generation,
          kind: 'Rollback',
          actorId: identity.principal.subjectId,
        },
      });
      await audit(tx, identity, 'CodeRolledBack', next.proposalId, { generation: next.generation });
      return next;
    });
  });
  app.get('/v1/tool-data', async (request) => {
    const identity = allow(request, 'code:data');
    for (const source of toolDataSources) toolDataSource(identity, source.id);
    return { sources: toolDataSources };
  });
  app.get('/v1/tool-data/:sourceId', async (request) => {
    const identity = allow(request, 'code:data');
    const { sourceId } = z.object({ sourceId: z.string().max(100) }).parse(request.params);
    return { records: toolDataChoices(identity, sourceId) };
  });
  let evaluating = false;
  app.post('/v1/code-evaluate', async (request) => {
    const identity = allow(request, 'code:read');
    const {
      proposalId,
      input: manual,
      recordId,
    } = z
      .object({
        proposalId: z.string().uuid().nullable(),
        input: toolManualInputSchema,
        recordId: z.string().min(1).max(100).optional(),
      })
      .strict()
      .parse(request.body);
    const active = proposalId === null ? await pointer(identity) : null;
    const id = proposalId ?? active?.proposalId;
    if (!id) throw new EvolutionError(409, 'INACTIVE', 'No calculator is active yet.');
    const p = await find(identity, id);
    verify(p);
    const binding = p.binding == null ? null : toolBindingSchema.parse(p.binding);
    if ((binding && !recordId) || (!binding && recordId))
      throw new EvolutionError(
        422,
        'RECORD_REQUIRED',
        binding
          ? 'Choose a workspace record for this tool.'
          : 'This tool uses manually entered values.',
      );
    const input = binding
      ? bindingValidation(() =>
          resolveToolInput(
            binding,
            (p.cases as Cases)[0].input,
            toolDataSource(identity, binding.sourceId),
            manual,
            toolDataRow(identity, binding.sourceId, recordId!),
          ),
        )
      : toolRecordSchema.parse(manual);
    if (!['Ready', 'PendingApproval', 'Approved', 'Published'].includes(p.state))
      throw new EvolutionError(409, 'NOT_READY', 'Wait for this calculator to finish its checks.');
    if (!matchesToolContract(input, (p.cases as Cases)[0].input))
      throw new EvolutionError(422, 'INPUT_FIELDS', 'Fill in every calculator input.');
    if (evaluating)
      throw new EvolutionError(429, 'BUSY', 'A calculation is running. Try again shortly.');
    evaluating = true;
    try {
      const evaluated = await engine.evaluate(
        p.source as Draft,
        p.cases as Cases,
        p.request,
        input,
      );
      const result = toolRecordSchema.parse(evaluated.result);
      if (!matchesToolContract(result, (p.cases as Cases)[0].expected))
        throw new Error('Output does not match the reviewed contract.');
      return {
        ...evaluated,
        result,
        effectiveInput: input,
        recordId: recordId ?? null,
        proposalId: id,
        generation: active?.generation ?? null,
      };
    } catch {
      throw new EvolutionError(
        422,
        'CALCULATION_FAILED',
        'This input could not be calculated safely. Try different values.',
      );
    } finally {
      evaluating = false;
    }
  });
  let stopped = false,
    working: Promise<void> | null = null;
  const tick = async () => {
    await db.codeProposal.updateMany({
      where: { state: 'Generating', leaseUntil: { lt: new Date() } },
      data: {
        state: 'Failed',
        error: 'Generation was interrupted. Create a new request.',
        lockVersion: { increment: 1 },
      },
    });
    const p = await db.codeProposal.findFirst({
      where: { state: 'Queued' },
      orderBy: { createdAt: 'asc' },
    });
    if (!p) return;
    const claim = await db.codeProposal.updateMany({
      where: { id: p.id, state: 'Queued', lockVersion: p.lockVersion },
      data: {
        state: 'Generating',
        leaseUntil: new Date(Date.now() + 600000),
        lockVersion: { increment: 1 },
      },
    });
    if (!claim.count) return;
    try {
      const { draft, report } = await engine.generate(p.request, p.cases as Cases);
      if (report.passed !== (p.cases as Cases).length)
        throw new Error('Not all acceptance cases passed.');
      await db.$transaction(async (tx) => {
        const result = await tx.codeProposal.updateMany({
          where: { id: p.id, state: 'Generating', lockVersion: p.lockVersion + 1 },
          data: {
            state: 'Ready',
            source: json(draft),
            summary: draft.summary,
            contentHash: contentHash(toolReviewContent(draft, p.cases, p.request, p.binding)),
            report: json(report),
            leaseUntil: null,
            lockVersion: { increment: 1 },
          },
        });
        if (result.count)
          await tx.auditEvent.create({
            data: {
              id: randomUUID(),
              applicationId: p.applicationId,
              tenantId: p.tenantId,
              actorId: 'code-worker',
              eventType: 'CodeChecked',
              resourceId: p.id,
              correlationId: randomUUID(),
              metadata: { passed: report.passed },
            },
          });
      });
    } catch (error) {
      await db.codeProposal.updateMany({
        where: { id: p.id, state: 'Generating', lockVersion: p.lockVersion + 1 },
        data: {
          state: 'Failed',
          error:
            error instanceof Error && error.message === 'Generation failed (HTTP 429).'
              ? 'The AI assistant reached a usage limit. Try again later, or choose the free built-in discount example.'
              : 'We couldn’t build a checked tool. Check the assistant and Docker, then start a new request.',
          leaseUntil: null,
          lockVersion: { increment: 1 },
        },
      });
    }
  };
  const timer = runWorker
    ? setInterval(() => {
        if (!stopped && !working) {
          working = tick()
            .catch(() => {})
            .finally(() => {
              working = null;
            });
        }
      }, 1000)
    : null;
  return async () => {
    stopped = true;
    if (timer) clearInterval(timer);
    await working;
  };
}
