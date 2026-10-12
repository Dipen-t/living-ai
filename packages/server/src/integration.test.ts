import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { registry, legacyRegistry } from '../../../apps/demo-erp/src/fixtures';
import { createDemoApi, demoAccounts } from '../../../apps/demo-api/src/app';
import {
  EvolutionService,
  contentHash,
  type ActionContext,
  type AuthorizationAdapter,
} from './service';
import type { Permission, RevisionEnvelope, RuntimeOperation } from '@evolvekit/core';
import { LocalRulesPlanner, PlannerError, type PlannerProvider } from '@evolvekit/ai';

// Each run owns a disposable schema on EvolveKit's local database. No public/other-project data is reset.
const schema = `evolvekit_test_${randomUUID().replaceAll('-', '')}`;
const baseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://evolvekit:evolvekit_local_only@127.0.0.1:54329/evolvekit';
const url = new URL(baseUrl);
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.port !== '54329' ||
  url.pathname !== '/evolvekit'
)
  throw new Error(
    'Integration tests require the dedicated local EvolveKit database on port 54329.',
  );
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
const roles: Record<string, Permission[]> = {
  requester: ['evolution:read', 'evolution:request', 'evolution:refine', 'evolution:submit'],
  approver: [
    'evolution:read',
    'evolution:approve',
    'evolution:publish',
    'evolution:rollback',
    'evolution:audit',
  ],
};
const authorization: AuthorizationAdapter = {
  async authenticate() {
    throw new Error('Service tests supply trusted contexts.');
  },
  async authorize(principal, permission, resource) {
    return (
      principal.applicationId === resource.applicationId &&
      principal.tenantId === resource.tenantId &&
      !!roles[principal.subjectId]?.includes(permission) &&
      (!resource.requesterId ||
        principal.subjectId === resource.requesterId ||
        principal.subjectId === 'approver')
    );
  },
};
const testRegistry = { ...registry, applicationId: 'integration-app' };
const service = new EvolutionService(db, authorization, testRegistry);
let requester: ActionContext, approver: ActionContext, foreign: ActionContext;
const operation = (days = 90): RuntimeOperation[] => [
  {
    capabilityId: 'customer-filter',
    kind: 'add_filter',
    filter: {
      id: `inactive-${days}`,
      label: `Inactive ${days}`,
      fieldId: 'lastPurchaseAt',
      operator: 'older_than_days',
      value: days,
    },
  },
];
const action = (revision: RevisionEnvelope) => ({
  revisionId: revision.revisionId,
  configurationHash: revision.configurationHash,
  expectedLockVersion: revision.lockVersion,
});
const create = async (days = 90) => {
  const active = await service.getActive(requester, 'customers');
  return service.createRequest(requester, {
    pageId: 'customers',
    text: 'Customer follow-up',
    operations: operation(days),
    expectedGeneration: active.generation,
    idempotencyKey: randomUUID(),
  });
};
const approve = async (revision: RevisionEnvelope) => {
  const submitted = await service.submit(requester, revision.proposalId, action(revision));
  return service.approve(approver, revision.proposalId, action(submitted));
};
const publish = (revision: RevisionEnvelope, key = randomUUID()) =>
  service.publish(approver, {
    revisionId: revision.revisionId,
    expectedGeneration: revision.baseGeneration,
    idempotencyKey: key,
  });

beforeAll(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url.href },
    stdio: 'pipe',
  });
  await service.initialize([{ id: 'foreign', name: 'Foreign tenant' }]);
});
beforeEach(async () => {
  const tenantId = `tenant-${randomUUID()}`;
  await service.initialize([{ id: tenantId, name: 'Disposable test tenant' }]);
  requester = {
    principal: { applicationId: 'integration-app', tenantId, subjectId: 'requester' },
    correlationId: randomUUID(),
  };
  approver = {
    ...requester,
    principal: { ...requester.principal, subjectId: 'approver' },
    correlationId: randomUUID(),
  };
  foreign = { ...approver, principal: { ...approver.principal, tenantId: 'foreign' } };
});
afterAll(async () => {
  if (!/^evolvekit_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected schema name.');
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
});

const enqueue = (
  text = 'Show customers with no purchase in 90 days and hide revenue',
  key = randomUUID(),
) =>
  service.enqueueRequest(requester, {
    pageId: 'customers',
    text,
    expectedGeneration: 1,
    idempotencyKey: key,
  });
const localPlanner = new LocalRulesPlanner();
describe('Durable proposal planning', () => {
  it('preserves decision types and explanations through preview, activation, and rollback', async () => {
    const cases = [false, true, false].map((overdue) => ({
      input: { tier: 'gold', amount: 12000, overdue },
      expected: {
        eligible: !overdue,
        reason: overdue ? 'Overdue payment' : 'Gold discount',
        discount: overdue ? 0 : 10,
      },
    }));
    const draft = {
      featureId: 'discount-rule',
      summary: 'Discount decision',
      files: {
        'logic.ts':
          'export function evaluate(input: Record<string, number | string | boolean>) { return { eligible: input.overdue === false, reason: input.overdue ? "Overdue payment" : "Gold discount", discount: input.overdue ? 0 : 10 }; }',
        'Feature.tsx':
          'import React from "react"; export function Feature() { return <div>Discount decision</div>; }',
      },
    };
    let invalidOutput = false,
      quotaLimited = false;
    const demo = await createDemoApi({
      databaseUrl: url.href,
      runWorker: true,
      codeEngine: {
        async baseCommit() {
          return 'a'.repeat(40);
        },
        async generate() {
          if (quotaLimited) throw new Error('Generation failed (HTTP 429).');
          return { draft, report: { passed: 3, preview: '<div>Discount decision</div>' } };
        },
        async evaluate(_draft, _cases, _request, input) {
          return {
            result: {
              eligible: invalidOutput ? 'yes' : !input.overdue,
              reason: input.overdue ? 'Overdue payment' : 'Gold discount',
              discount: input.overdue ? 0 : 10,
            },
            preview: '<div>Discount decision</div>',
          };
        },
      },
    });
    const origin = 'http://127.0.0.1:5173';
    const post = (cookie: string, route: string, payload: unknown) =>
      demo.app.inject({
        method: 'POST',
        url: route,
        headers: {
          cookie,
          origin,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        payload: JSON.stringify(payload),
      });
    const login = async (account: string) =>
      String((await post('', '/demo/session', { account })).headers['set-cookie']).split(';')[0];
    const requesterScope = demoAccounts.requester.principal;
    const reviewerScope = demoAccounts.approver.principal;
    try {
      await demo.db.tenant.create({
        data: { applicationId: 'demo-erp', id: 'decision-org', name: 'Decision test' },
      });
      demoAccounts.requester.principal = { ...requesterScope, tenantId: 'decision-org' };
      demoAccounts.approver.principal = { ...reviewerScope, tenantId: 'decision-org' };
      const maya = await login('requester'),
        arun = await login('approver');
      const inconsistent = structuredClone(cases);
      (inconsistent[1].input as Record<string, unknown>).overdue = 'false';
      expect(
        (await post(maya, '/v1/code-proposals', { request: 'Discount', cases: inconsistent }))
          .statusCode,
      ).toBe(422);
      const created = await post(maya, '/v1/code-proposals', { request: 'Discount', cases });
      expect(created.statusCode).toBe(202);
      const id = created.json().id;
      let proposal: any;
      for (let attempt = 0; attempt < 40; attempt++) {
        proposal = await demo.db.codeProposal.findUnique({ where: { id } });
        if (proposal?.state === 'Ready') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(proposal.state).toBe('Ready');
      const input = { tier: 'gold', amount: 15000, overdue: false };
      expect(
        (
          await post(maya, '/v1/code-evaluate', {
            proposalId: id,
            input: { ...input, overdue: 'false' },
          })
        ).statusCode,
      ).toBe(422);
      const preview = await post(maya, '/v1/code-evaluate', { proposalId: id, input });
      expect(preview.json().result).toEqual({
        eligible: true,
        reason: 'Gold discount',
        discount: 10,
      });
      invalidOutput = true;
      expect((await post(maya, '/v1/code-evaluate', { proposalId: id, input })).statusCode).toBe(
        422,
      );
      invalidOutput = false;
      const action = () => ({
        contentHash: proposal.contentHash,
        expectedVersion: proposal.lockVersion,
      });
      expect((await post(maya, `/v1/code-proposals/${id}/submit`, action())).statusCode).toBe(200);
      proposal = await demo.db.codeProposal.findUnique({ where: { id } });
      expect((await post(arun, `/v1/code-proposals/${id}/approve`, action())).statusCode).toBe(200);
      proposal = await demo.db.codeProposal.findUnique({ where: { id } });
      expect(
        (
          await post(arun, `/v1/code-proposals/${id}/activate`, {
            ...action(),
            expectedGeneration: 0,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await post(maya, '/v1/code-evaluate', { proposalId: null, input })).json().result,
      ).toEqual(preview.json().result);
      expect(
        (
          await post(maya, '/v1/code-evaluate', {
            proposalId: null,
            input: { ...input, overdue: true },
          })
        ).json().result,
      ).toEqual({ eligible: false, reason: 'Overdue payment', discount: 0 });
      const release = await demo.db.codeRelease.findFirst({ where: { proposalId: id } });
      expect(
        (await post(arun, '/v1/code-rollback', { releaseId: release!.id, expectedGeneration: 1 }))
          .statusCode,
      ).toBe(200);
      expect((await post(maya, '/v1/code-evaluate', { proposalId: null, input })).statusCode).toBe(
        409,
      );
      expect(await demo.db.codeProposal.findUnique({ where: { id } })).not.toBeNull();
      quotaLimited = true;
      const limited = await post(maya, '/v1/code-proposals', {
        request: 'Synthetic quota test',
        cases,
      });
      expect(limited.statusCode).toBe(202);
      let failure: any;
      for (let attempt = 0; attempt < 40; attempt++) {
        failure = await demo.db.codeProposal.findUnique({ where: { id: limited.json().id } });
        if (failure?.state === 'Failed') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(failure.state).toBe('Failed');
      expect(failure.error).toContain('usage limit');
      expect(failure.error).toContain('free built-in');
    } finally {
      demoAccounts.requester.principal = requesterScope;
      demoAccounts.approver.principal = reviewerScope;
      await demo.app.close();
    }
  });
  it('persists exact-source code reviews, isolates scopes, rejects conflicting activation and rolls back without deleting drafts', async () => {
    const cases = [1, 2, 3].map((amount) => ({
      input: { amount },
      expected: { total: amount * 2 },
    }));
    const draft = {
      featureId: 'double-amount',
      summary: 'Double the amount',
      files: {
        'logic.ts':
          'export function evaluate(input: Record<string, number>) { return { total: input.amount * 2 }; }',
        'Feature.tsx':
          'import React from "react"; import {evaluate} from "./logic"; export function Feature({input}: {input: Record<string, number>}) { return <div>{evaluate(input).total}</div>; }',
      },
    };
    let baseCommit = 'a'.repeat(40);
    const engine = {
      async baseCommit() {
        return baseCommit;
      },
      async generate() {
        return { draft, report: { passed: 3, preview: '<div>2</div>' } };
      },
      async evaluate(
        _draft: unknown,
        _cases: unknown,
        _request: string,
        input: Record<string, number | string | boolean>,
      ) {
        return {
          result: { total: Number(input.amount) * 2 },
          preview: '<div>' + Number(input.amount) * 2 + '</div>',
        };
      },
    };
    let demo = await createDemoApi({ databaseUrl: url.href, codeEngine: engine, runWorker: true });
    const origin = 'http://127.0.0.1:5173';
    const login = async (account: string) => {
      const response = await demo.app.inject({
        method: 'POST',
        url: '/demo/session',
        headers: { origin },
        payload: { account },
      });
      return String(response.headers['set-cookie']).split(';')[0];
    };
    const maya = await login('requester'),
      arun = await login('approver');
    const post = (cookie: string, route: string, payload: unknown, key = randomUUID()) =>
      demo.app.inject({
        method: 'POST',
        url: route,
        headers: { cookie, origin, 'idempotency-key': key, 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
    const listing = async (cookie = maya) =>
      (
        await demo.app.inject({ method: 'GET', url: '/v1/code-proposals', headers: { cookie } })
      ).json();
    try {
      expect((await demo.app.inject({ method: 'GET', url: '/v1/code-proposals' })).statusCode).toBe(
        401,
      );
      expect(
        (await post(arun, '/v1/code-proposals', { request: 'Double amount', cases })).statusCode,
      ).toBe(403);
      const key = randomUUID();
      const created = await post(
        maya,
        '/v1/code-proposals',
        { request: 'Double amount', cases },
        key,
      );
      expect(created.statusCode).toBe(202);
      const first = created.json();
      expect(
        (await post(maya, '/v1/code-proposals', { request: 'Double amount', cases }, key)).json()
          .id,
      ).toBe(first.id);
      expect(
        (await post(maya, '/v1/code-proposals', { request: 'Different', cases }, key)).statusCode,
      ).toBe(409);
      const second = (
        await post(maya, '/v1/code-proposals', { request: 'Double amount again', cases })
      ).json();
      let rows: any[] = [];
      for (let n = 0; n < 160; n++) {
        rows = (await listing()).proposals;
        if (
          [first.id, second.id].every((id) => rows.some((p) => p.id === id && p.state === 'Ready'))
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const ready = rows.filter((p) => [first.id, second.id].includes(p.id));
      expect(ready).toHaveLength(2);
      expect(ready.every((p) => p.state === 'Ready')).toBe(true);
      const p = ready[0];
      expect(
        (await post(maya, '/v1/code-evaluate', { proposalId: p.id, input: { amount: 7 } })).json()
          .result,
      ).toEqual({ total: 14 });
      expect(
        (await post(maya, '/v1/code-evaluate', { proposalId: p.id, input: { wrong: 7 } }))
          .statusCode,
      ).toBe(422);
      expect(
        (
          await post(maya, '/v1/code-proposals/' + p.id + '/approve', {
            contentHash: p.contentHash,
            expectedVersion: p.lockVersion,
          })
        ).statusCode,
      ).toBe(403);
      await expect(
        demo.db.codeProposal.update({ where: { id: p.id }, data: { source: { changed: true } } }),
      ).rejects.toThrow();
      const foreignId = randomUUID();
      await demo.db.codeProposal.create({
        data: {
          id: foreignId,
          applicationId: 'integration-app',
          tenantId: 'foreign',
          requesterId: 'foreign',
          request: 'foreign',
          cases,
          state: 'Ready',
          baseGeneration: 0,
          baseCommit,
          source: draft,
          contentHash: contentHash({ draft, cases, request: 'foreign' }),
          summary: draft.summary,
          report: { passed: 3 },
        },
      });
      expect((await listing()).proposals.some((p: any) => p.id === foreignId)).toBe(false);
      expect(
        (
          await post(arun, '/v1/code-proposals/' + foreignId + '/approve', {
            contentHash: p.contentHash,
            expectedVersion: 0,
          })
        ).statusCode,
      ).toBe(404);
      const approved: any[] = [];
      for (const proposal of ready) {
        const submitted = await post(maya, '/v1/code-proposals/' + proposal.id + '/submit', {
          contentHash: proposal.contentHash,
          expectedVersion: proposal.lockVersion,
        });
        expect(submitted.statusCode).toBe(200);
        expect(
          (
            await post(arun, '/v1/code-proposals/' + proposal.id + '/approve', {
              contentHash: '0'.repeat(64),
              expectedVersion: submitted.json().lockVersion,
            })
          ).statusCode,
        ).toBe(409);
        const review = await post(arun, '/v1/code-proposals/' + proposal.id + '/approve', {
          contentHash: proposal.contentHash,
          expectedVersion: submitted.json().lockVersion,
        });
        expect(review.statusCode).toBe(200);
        approved.push(review.json());
      }
      baseCommit = 'b'.repeat(40);
      expect(
        (
          await post(arun, '/v1/code-proposals/' + approved[0].id + '/activate', {
            contentHash: approved[0].contentHash,
            expectedVersion: approved[0].lockVersion,
            expectedGeneration: 0,
          })
        ).statusCode,
      ).toBe(409);
      baseCommit = 'a'.repeat(40);
      expect(
        (
          await post(maya, '/v1/code-proposals/' + approved[0].id + '/activate', {
            contentHash: approved[0].contentHash,
            expectedVersion: approved[0].lockVersion,
            expectedGeneration: 0,
          })
        ).statusCode,
      ).toBe(403);
      const publications = await Promise.all(
        approved.map((p) =>
          post(arun, '/v1/code-proposals/' + p.id + '/activate', {
            contentHash: p.contentHash,
            expectedVersion: p.lockVersion,
            expectedGeneration: 0,
          }),
        ),
      );
      expect(publications.map((p) => p.statusCode).sort()).toEqual([200, 409]);
      const live = (await listing()).active;
      expect(live.generation).toBe(1);
      expect(
        (await post(maya, '/v1/code-evaluate', { proposalId: null, input: { amount: 7 } })).json(),
      ).toMatchObject({ result: { total: 14 }, proposalId: live.proposalId, generation: 1 });
      const release = (await listing()).releases[0];
      await expect(
        demo.db.codeApproval.update({
          where: { proposalId: live.proposalId },
          data: { contentHash: '0'.repeat(64) },
        }),
      ).rejects.toThrow();
      expect(
        (await post(maya, '/v1/code-rollback', { releaseId: release.id, expectedGeneration: 1 }))
          .statusCode,
      ).toBe(403);
      expect(
        (await post(arun, '/v1/code-rollback', { releaseId: release.id, expectedGeneration: 0 }))
          .statusCode,
      ).toBe(409);
      expect(
        (
          await post(arun, '/v1/code-rollback', { releaseId: release.id, expectedGeneration: 1 })
        ).json(),
      ).toMatchObject({ proposalId: null, generation: 2 });
      expect(
        (await post(maya, '/v1/code-evaluate', { proposalId: null, input: { amount: 7 } }))
          .statusCode,
      ).toBe(409);
      await demo.app.close();
      demo = await createDemoApi({ databaseUrl: url.href, codeEngine: engine, runWorker: false });
      const after = (
        await demo.app.inject({
          method: 'GET',
          url: '/v1/code-proposals',
          headers: { cookie: await login('requester') },
        })
      ).json();
      expect(after.active).toMatchObject({ proposalId: null, generation: 2 });
      expect(after.proposals.filter((p: any) => [first.id, second.id].includes(p.id))).toHaveLength(
        2,
      );
      expect(after.releases).toHaveLength(2);
    } finally {
      await demo.app.close();
    }
  });
  it('requires activation for follow-ups, persists tasks across restart, enforces ownership, and preserves data through rollback', async () => {
    let demo = await createDemoApi({ databaseUrl: url.href, runWorker: false });
    const maya = {
      principal: { applicationId: 'demo-erp', tenantId: 'demo-org', subjectId: 'maya' },
      correlationId: randomUUID(),
    };
    const arun = { ...maya, principal: { ...maya.principal, subjectId: 'arun' } };
    const origin = 'http://127.0.0.1:5173';
    const login = async (account: string) =>
      String(
        (
          await demo.app.inject({
            method: 'POST',
            url: '/demo/session',
            headers: { origin },
            payload: { account },
          })
        ).headers['set-cookie'],
      ).split(';')[0];
    try {
      let mayaCookie = await login('requester'),
        arunCookie = await login('approver');
      const read = () =>
        demo.app.inject({ method: 'GET', url: '/v1/followups', headers: { cookie: mayaCookie } });
      expect((await demo.app.inject({ method: 'GET', url: '/v1/followups' })).statusCode).toBe(401);
      expect((await read()).statusCode).toBe(409);
      const original = await demo.service.getActive(maya, 'customers');
      const draft = await demo.service.createRequest(maya, {
        pageId: 'customers',
        text: 'Enable follow-ups',
        expectedGeneration: original.generation,
        idempotencyKey: randomUUID(),
        operations: [
          {
            kind: 'set_feature',
            capabilityId: 'customer-followups-workflow',
            featureId: 'customer-followups',
            enabled: true,
          },
        ],
      });
      expect((await read()).statusCode).toBe(409);
      const submitted = await demo.service.submit(maya, draft.proposalId, action(draft));
      const approved = await demo.service.approve(arun, draft.proposalId, action(submitted));
      const active = await demo.service.publish(arun, {
        revisionId: approved.revisionId,
        expectedGeneration: original.generation,
        idempotencyKey: randomUUID(),
      });
      const key = randomUUID(),
        input = {
          customerId: 'c1',
          title: 'Call about renewal',
          ownerId: 'arun',
          dueDate: '2026-10-01',
        };
      const createTask = (payload = input) =>
        demo.app.inject({
          method: 'POST',
          url: '/v1/followups',
          headers: { origin, cookie: mayaCookie, 'idempotency-key': key },
          payload,
        });
      const response = await createTask();
      expect(response.statusCode).toBe(200);
      const task = response.json();
      await demo.db.tenant.create({
        data: { applicationId: 'demo-erp', id: 'other-followup-tenant', name: 'Other workspace' },
      });
      await demo.db.followUpCustomer.create({
        data: {
          applicationId: 'demo-erp',
          tenantId: 'other-followup-tenant',
          id: 'foreign-customer',
          name: 'Other Customer',
          company: 'Other Company',
        },
      });
      const foreignTask = await demo.db.followUp.create({
        data: {
          id: randomUUID(),
          applicationId: 'demo-erp',
          tenantId: 'other-followup-tenant',
          customerId: 'foreign-customer',
          title: 'Other workspace task',
          ownerId: 'maya',
          dueDate: new Date('2026-10-01T00:00:00Z'),
          createdBy: 'maya',
        },
      });
      expect((await read()).json()).not.toContainEqual(
        expect.objectContaining({ id: foreignTask.id }),
      );
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: `/v1/followups/${foreignTask.id}`,
            headers: { origin, cookie: arunCookie },
            payload: { expectedVersion: 0, status: 'completed' },
          })
        ).statusCode,
      ).toBe(404);
      expect((await createTask()).json()).toEqual(task);
      expect((await createTask({ ...input, title: 'Different task' })).statusCode).toBe(409);
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: '/v1/followups',
            headers: { origin, cookie: mayaCookie, 'idempotency-key': randomUUID() },
            payload: { ...input, dueDate: '2026-02-30' },
          })
        ).statusCode,
      ).toBe(422);
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: '/v1/followups',
            headers: { origin, cookie: mayaCookie, 'idempotency-key': randomUUID() },
            payload: { ...input, customerId: 'unknown' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: `/v1/followups/${task.id}`,
            headers: { origin, cookie: mayaCookie },
            payload: { expectedVersion: task.version, status: 'completed' },
          })
        ).statusCode,
      ).toBe(403);
      const complete = await demo.app.inject({
        method: 'POST',
        url: `/v1/followups/${task.id}`,
        headers: { origin, cookie: arunCookie },
        payload: { expectedVersion: task.version, status: 'completed' },
      });
      expect(complete.json()).toMatchObject({ status: 'completed', version: 1 });
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: `/v1/followups/${task.id}`,
            headers: { origin, cookie: mayaCookie },
            payload: { expectedVersion: 1, ownerId: 'maya' },
          })
        ).json(),
      ).toMatchObject({ ownerId: 'maya', version: 2 });
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: `/v1/followups/${task.id}`,
            headers: { origin, cookie: mayaCookie },
            payload: { expectedVersion: 2, status: 'pending' },
          })
        ).json(),
      ).toMatchObject({ status: 'pending', version: 3 });
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: `/v1/followups/${task.id}`,
            headers: { origin, cookie: mayaCookie },
            payload: { expectedVersion: 3, status: 'completed' },
          })
        ).json(),
      ).toMatchObject({ status: 'completed', version: 4 });
      expect(
        await demo.db.auditEvent.count({
          where: { eventType: 'FollowUpCreated', resourceId: task.id },
        }),
      ).toBe(1);
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: `/v1/followups/${task.id}`,
            headers: { origin, cookie: arunCookie },
            payload: { expectedVersion: task.version, status: 'pending' },
          })
        ).statusCode,
      ).toBe(409);
      await demo.app.close();
      demo = await createDemoApi({ databaseUrl: url.href, runWorker: false });
      mayaCookie = await login('requester');
      arunCookie = await login('approver');
      expect((await read()).json()).toContainEqual(
        expect.objectContaining({ id: task.id, status: 'completed' }),
      );
      await demo.service.rollback(arun, {
        pageId: 'customers',
        targetVersionId: original.versionId,
        expectedGeneration: active.generation,
        reason: 'Hide workflow',
        idempotencyKey: randomUUID(),
      });
      expect((await read()).statusCode).toBe(409);
      expect(
        (
          await demo.app.inject({
            method: 'POST',
            url: `/v1/followups/${task.id}`,
            headers: { origin, cookie: arunCookie },
            payload: { expectedVersion: 4, status: 'pending' },
          })
        ).statusCode,
      ).toBe(409);
      expect((await demo.db.followUp.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
        'completed',
      );
      const hidden = await demo.service.getActive(maya, 'customers');
      const again = await demo.service.createRequest(maya, {
        pageId: 'customers',
        text: 'Restore workflow',
        expectedGeneration: hidden.generation,
        idempotencyKey: randomUUID(),
        operations: [
          {
            kind: 'set_feature',
            capabilityId: 'customer-followups-workflow',
            featureId: 'customer-followups',
            enabled: true,
          },
        ],
      });
      const resubmitted = await demo.service.submit(maya, again.proposalId, action(again));
      const reapproved = await demo.service.approve(arun, again.proposalId, action(resubmitted));
      const restored = await demo.service.publish(arun, {
        revisionId: reapproved.revisionId,
        expectedGeneration: hidden.generation,
        idempotencyKey: randomUUID(),
      });
      expect((await read()).json()).toContainEqual(
        expect.objectContaining({ id: task.id, status: 'completed' }),
      );
      await demo.service.rollback(arun, {
        pageId: 'customers',
        targetVersionId: original.versionId,
        expectedGeneration: restored.generation,
        reason: 'Finish test',
        idempotencyKey: randomUUID(),
      });
    } finally {
      await demo.app.close();
    }
  });
  it('pins button definitions and publishes and rolls back a layout change without touching Orders', async () => {
    const original = await service.getActive(requester, 'customers');
    const ordersBefore = await service.getActive(requester, 'orders');
    const job = await enqueue(
      'Move the Add Customer button above the table and rename it to New Customer',
    );
    await service.runPlannerOnce(localPlanner);
    expect((await service.getPlannerJob(requester, job.jobId)).status).toBe('Succeeded');
    const draft = await service.getRevision(requester, job.proposalId);
    expect(draft.configuration.actions).toEqual([
      { actionId: 'add-customer', label: 'New Customer', position: 'above_table' },
    ]);
    expect(draft.configuration.columns).toEqual(original.configuration.columns);
    const current = await publish(await approve(draft));
    expect(current.configurationHash).toBe(draft.configurationHash);
    await service.rollback(approver, {
      pageId: 'customers',
      targetVersionId: original.versionId,
      expectedGeneration: current.generation,
      reason: 'Restore button position',
      idempotencyKey: randomUUID(),
    });
    expect((await service.getActive(requester, 'customers')).configurationHash).toBe(
      original.configurationHash,
    );
    expect(await service.getActive(requester, 'orders')).toEqual(ordersBefore);
  });
  it('publishes and restores Orders independently of Customers', async () => {
    const customerBefore = await service.getActive(requester, 'customers');
    const orderBefore = await service.getActive(requester, 'orders');
    const job = await service.enqueueRequest(requester, {
      pageId: 'orders',
      text: 'format amount with international commas',
      expectedGeneration: orderBefore.generation,
      idempotencyKey: randomUUID(),
    });
    await service.runPlannerOnce(localPlanner);
    expect((await service.getPlannerJob(requester, job.jobId)).status).toBe('Succeeded');
    const revision = await service.getRevision(requester, job.proposalId);
    expect(revision.configuration.pageId).toBe('orders');
    expect(
      revision.configuration.columns.find((column) => column.fieldId === 'amount')?.numberFormat,
    ).toBe('international');
    const approved = await approve(revision);
    const published = await publish(approved);
    expect(published.configurationHash).toBe(revision.configurationHash);
    expect(await service.getActive(requester, 'customers')).toEqual(customerBefore);
    await service.rollback(approver, {
      pageId: 'orders',
      targetVersionId: orderBefore.versionId,
      expectedGeneration: published.generation,
      reason: 'Restore order display',
      idempotencyKey: randomUUID(),
    });
    expect((await service.getActive(requester, 'orders')).configurationHash).toBe(
      orderBefore.configurationHash,
    );
    expect(await service.getActive(requester, 'customers')).toEqual(customerBefore);
    await expect(
      service.createRequest(requester, {
        pageId: 'orders',
        text: 'Wrong page capability',
        expectedGeneration: published.generation + 1,
        idempotencyKey: randomUUID(),
        operations: [
          {
            capabilityId: 'customer-number-format',
            kind: 'set_number_format',
            fieldId: 'amount',
            format: 'plain',
          },
        ],
      }),
    ).rejects.toThrow();
  });
  it('previews, approves, publishes, and rolls back a persisted number-format change', async () => {
    const original = await service.getActive(requester, 'customers');
    const job = await enqueue('format revenue with international commas');
    await service.runPlannerOnce(localPlanner);
    const result = await service.getPlannerJob(requester, job.jobId);
    expect(result.status).toBe('Succeeded');
    const revision = await service.getRevision(requester, job.proposalId);
    expect(
      revision.configuration.columns.find((column) => column.fieldId === 'revenue')?.numberFormat,
    ).toBe('international');
    expect((await service.getActive(requester, 'customers')).versionId).toBe(original.versionId);
    await expect(publish(revision)).rejects.toThrow();
    const approved = await approve(revision);
    await publish(approved);
    const current = await service.getActive(requester, 'customers');
    expect(current.configurationHash).toBe(revision.configurationHash);
    await service.rollback(approver, {
      pageId: 'customers',
      targetVersionId: original.versionId,
      expectedGeneration: current.generation,
      reason: 'Restore the prior number style',
      idempotencyKey: randomUUID(),
    });
    expect((await service.getActive(requester, 'customers')).configurationHash).toBe(
      original.configurationHash,
    );
  });
  it('explicitly upgrades an additive registry without rewriting old drafts, active versions, or approvals', async () => {
    const applicationId = `upgrade-${randomUUID()}`;
    const previous = { ...structuredClone(legacyRegistry), applicationId };
    const next = { ...structuredClone(registry), applicationId };
    const oldService = new EvolutionService(db, authorization, previous);
    await oldService.initialize([{ id: 'tenant', name: 'Upgrade tenant' }]);
    const requestContext = {
      ...requester,
      principal: { ...requester.principal, applicationId, tenantId: 'tenant' },
    };
    const approvalContext = {
      ...approver,
      principal: { ...approver.principal, applicationId, tenantId: 'tenant' },
    };
    const active = await oldService.getActive(requestContext, 'customers');
    const draft = await oldService.createRequest(requestContext, {
      pageId: 'customers',
      text: 'Old draft',
      operations: operation(),
      expectedGeneration: active.generation,
      idempotencyKey: randomUUID(),
    });
    const nextService = new EvolutionService(db, authorization, next, [previous]);
    await nextService.initialize([{ id: 'tenant', name: 'Upgrade tenant' }]);
    expect(await nextService.getActive(requestContext, 'customers')).toEqual(active);
    expect((await nextService.getActive(requestContext, 'orders')).generation).toBe(1);
    expect(
      (await nextService.getRevision(requestContext, draft.proposalId)).configurationHash,
    ).toBe(draft.configurationHash);
    const submitted = await nextService.submit(requestContext, draft.proposalId, action(draft));
    const approved = await nextService.approve(
      approvalContext,
      draft.proposalId,
      action(submitted),
    );
    await nextService.publish(approvalContext, {
      revisionId: approved.revisionId,
      expectedGeneration: active.generation,
      idempotencyKey: randomUUID(),
    });
    expect((await nextService.getActive(requestContext, 'customers')).configurationHash).toBe(
      draft.configurationHash,
    );
    expect(
      await db.auditEvent.count({ where: { applicationId, eventType: 'RegistryExtended' } }),
    ).toBe(1);
    await nextService.initialize([{ id: 'tenant', name: 'Upgrade tenant' }]);
    expect(
      await db.auditEvent.count({ where: { applicationId, eventType: 'RegistryExtended' } }),
    ).toBe(1);
  });
  it('pins inputs, replays enqueue idempotently and produces a validated unapproved revision', async () => {
    const key = randomUUID();
    const job = await enqueue(undefined, key);
    expect(await enqueue(undefined, key)).toEqual(job);
    await expect(enqueue('Hide region', key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const stored = await db.plannerJob.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(stored.input).not.toHaveProperty('rows');
    expect((stored.input as any).page).not.toHaveProperty('dataAdapter');
    // A new service instance discovers the durable queue; no in-memory task state is necessary.
    const restarted = new EvolutionService(db, authorization, testRegistry);
    expect(await restarted.runPlannerOnce(localPlanner)).toBe(true);
    const completed = await service.getPlannerJob(requester, job.jobId);
    expect(completed).toMatchObject({ status: 'Succeeded', attempts: 1, resultCode: 'VALIDATED' });
    const revision = await service.getRevision(requester, job.proposalId);
    expect(revision.state).toBe('ReadyForPreview');
    expect(revision.configuration.filters[0]).toMatchObject({ value: 90 });
    expect(revision.configuration.columns.find((c) => c.fieldId === 'revenue')?.visible).toBe(
      false,
    );
    expect((await service.getActive(requester, 'customers')).generation).toBe(1);
    await expect(publish(revision)).rejects.toMatchObject({ status: 409 });
    const approved = await approve(revision);
    expect((await publish(approved)).generation).toBe(2);
  });
  it('keeps unsupported and ambiguous results out of preview', async () => {
    for (const [text, status] of [
      ['Delete all customers', 'Unsupported'],
      ['Hide salary', 'NeedsClarification'],
    ]) {
      const job = await enqueue(text);
      await service.runPlannerOnce(localPlanner);
      expect((await service.getPlannerJob(requester, job.jobId)).status).toBe(status);
      expect(await db.proposalRevision.count({ where: { proposalId: job.proposalId } })).toBe(0);
    }
    expect((await service.getActive(requester, 'customers')).generation).toBe(1);
  });
  it('rejects hallucinated capabilities through authoritative server validation', async () => {
    const job = await enqueue();
    await service.runPlannerOnce({
      async generate() {
        return {
          kind: 'runtime',
          summary: 'Unsafe',
          operations: [{ ...operation()[0], capabilityId: 'arbitrary-code' }],
        };
      },
    });
    expect(await service.getPlannerJob(requester, job.jobId)).toMatchObject({
      status: 'Failed',
      resultCode: 'INVALID_CONFIGURATION',
    });
    expect(await db.proposalRevision.count({ where: { proposalId: job.proposalId } })).toBe(0);
  });
  it('uses one worker lease for competing consumers and never duplicates completion', async () => {
    const job = await enqueue();
    let release!: () => void,
      started!: () => void,
      calls = 0;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: PlannerProvider = {
      async generate(input, signal) {
        calls++;
        started();
        await gate;
        return localPlanner.generate(input, signal);
      },
    };
    const running = service.runPlannerOnce(provider);
    await ready;
    expect(await service.runPlannerOnce(provider)).toBe(false);
    release();
    await running;
    expect(calls).toBe(1);
    expect(await db.proposalRevision.count({ where: { proposalId: job.proposalId } })).toBe(1);
    expect(await service.runPlannerOnce(provider)).toBe(false);
  });
  it('recovers an expired lease and terminates after exhausted crash attempts', async () => {
    const job = await enqueue();
    await db.plannerJob.update({
      where: { id: job.jobId },
      data: {
        status: 'Running',
        attempts: 1,
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() - 1000),
      },
    });
    await service.runPlannerOnce(localPlanner);
    expect(await service.getPlannerJob(requester, job.jobId)).toMatchObject({
      status: 'Succeeded',
      attempts: 2,
    });
    const exhausted = await enqueue('Hide revenue');
    for (let attempts = 1; attempts <= 3; attempts++)
      await db.plannerJob.update({
        where: { id: exhausted.jobId },
        data: {
          status: 'Running',
          attempts,
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() - 1000),
        },
      });
    expect(await service.runPlannerOnce(localPlanner)).toBe(false);
    expect(await service.getPlannerJob(requester, exhausted.jobId)).toMatchObject({
      status: 'Failed',
      resultCode: 'LEASE_EXHAUSTED',
      attempts: 3,
    });
  });
  it('bounds a provider that ignores abort and retries at most three total attempts', async () => {
    const job = await enqueue();
    let calls = 0;
    const provider: PlannerProvider = {
      generate() {
        calls++;
        return new Promise(() => {});
      },
    };
    for (let attempt = 1; attempt <= 3; attempt++)
      await service.runPlannerOnce(provider, { timeoutMs: 10, retryDelayMs: 0 });
    expect(calls).toBe(3);
    expect(await service.getPlannerJob(requester, job.jobId)).toMatchObject({
      status: 'Failed',
      resultCode: 'PLANNER_TIMEOUT',
      attempts: 3,
    });
    expect(await service.runPlannerOnce(provider)).toBe(false);
  });
  it('rechecks permission after generation and preserves the original state on revocation', async () => {
    const job = await enqueue();
    const original = roles.requester;
    try {
      await service.runPlannerOnce({
        async generate(input, signal) {
          const result = await localPlanner.generate(input, signal);
          roles.requester = ['evolution:read'];
          return result;
        },
      });
      expect(await service.getPlannerJob(requester, job.jobId)).toMatchObject({
        status: 'Failed',
        resultCode: 'FORBIDDEN',
      });
      expect(await db.proposalRevision.count({ where: { proposalId: job.proposalId } })).toBe(0);
    } finally {
      roles.requester = original;
    }
  });
  it('does not rebase a pending job when another proposal is published', async () => {
    const job = await enqueue();
    await publish(await approve(await create(30)));
    await service.runPlannerOnce(localPlanner);
    const revision = await service.getRevision(requester, job.proposalId);
    expect(revision.baseGeneration).toBe(1);
    expect(revision.baseConfiguration.filters).toHaveLength(0);
    await expect(publish(await approve(revision))).rejects.toMatchObject({ status: 409 });
    expect((await service.getActive(requester, 'customers')).generation).toBe(2);
  });
  it('refines immutably but refuses to overwrite a revision reviewed during generation', async () => {
    const first = await enqueue();
    await service.runPlannerOnce(localPlanner);
    const parent = await service.getRevision(requester, first.proposalId);
    const job = await service.enqueueRefinement(requester, parent.proposalId, {
      parentRevisionId: parent.revisionId,
      expectedLockVersion: parent.lockVersion,
      refinement: 'Filter last purchase older than 30 days',
      idempotencyKey: randomUUID(),
    });
    await service.runPlannerOnce(localPlanner);
    const pinnedRefinement = await db.plannerJob.findUniqueOrThrow({ where: { id: job.jobId } });
    await expect(
      db.plannerJob.create({
        data: {
          ...pinnedRefinement,
          id: randomUUID(),
          input: pinnedRefinement.input as any,
          expectedLockVersion: null,
          revisionId: null,
          status: 'Queued',
          completedAt: null,
          attempts: 0,
        },
      }),
    ).rejects.toThrow();
    const child = await service.getRevision(requester, parent.proposalId);
    expect(child).toMatchObject({ revisionNumber: 2, state: 'ReadyForPreview' });
    expect(child.operations.find((op) => op.kind === 'add_filter')).toMatchObject({
      filter: { value: 30 },
    });
    expect((await service.getRevision(requester, parent.proposalId, parent.revisionId)).state).toBe(
      'Superseded',
    );
    expect((await service.getPlannerJob(requester, job.jobId)).status).toBe('Succeeded');
    const race = await service.enqueueRefinement(requester, child.proposalId, {
      parentRevisionId: child.revisionId,
      expectedLockVersion: child.lockVersion,
      refinement: 'Show revenue',
      idempotencyKey: randomUUID(),
    });
    await service.submit(requester, child.proposalId, action(child));
    await service.runPlannerOnce(localPlanner);
    expect(await service.getPlannerJob(requester, race.jobId)).toMatchObject({
      status: 'Failed',
      resultCode: 'STALE_STATE',
    });
    expect((await service.getRevision(requester, child.proposalId)).state).toBe('PendingApproval');
  });
  it('isolates job reads, rejects mutated pinned inputs and limits queued work', async () => {
    const job = await enqueue();
    await expect(service.getPlannerJob(foreign, job.jobId)).rejects.toMatchObject({ status: 404 });
    await expect(
      db.plannerJob.update({ where: { id: job.jobId }, data: { input: {} } }),
    ).rejects.toThrow();
    await enqueue('Hide revenue');
    await enqueue('Hide region');
    await expect(enqueue('Show region')).rejects.toMatchObject({ status: 429 });
    for (let i = 0; i < 3; i++) await service.runPlannerOnce(localPlanner);
  });
  it('fences an old worker after lease takeover and preserves the winning result', async () => {
    const job = await enqueue();
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const oldRun = service.runPlannerOnce({
      async generate(input, signal) {
        started();
        await gate;
        return localPlanner.generate(input, signal);
      },
    });
    await ready;
    // Fault injection in this disposable schema simulates elapsed lease time without a 75-second sleep.
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "PlannerJob" DISABLE TRIGGER planner_job_transition');
      await tx.plannerJob.update({
        where: { id: job.jobId },
        data: { leaseUntil: new Date(Date.now() - 1000) },
      });
      await tx.$executeRawUnsafe('ALTER TABLE "PlannerJob" ENABLE TRIGGER planner_job_transition');
    });
    try {
      await service.runPlannerOnce({
        async generate(input, signal) {
          return localPlanner.generate({ ...input, request: 'Hide region' }, signal);
        },
      });
    } finally {
      release();
      await oldRun;
    }
    const revision = await service.getRevision(requester, job.proposalId);
    expect(revision.operations).toHaveLength(1);
    expect(revision.operations[0]).toMatchObject({ fieldId: 'region' });
    expect(await db.proposalRevision.count({ where: { proposalId: job.proposalId } })).toBe(1);
    expect((await service.getPlannerJob(requester, job.jobId)).attempts).toBe(2);
  });
  it('exposes authenticated async HTTP requests and immutable refinement jobs', async () => {
    const { app, service: apiService } = await createDemoApi({
      databaseUrl: url.href,
      planner: localPlanner,
      plannerMode: 'local',
      runWorker: false,
    });
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/evolution-requests',
            headers: { origin: 'http://127.0.0.1:5173', 'idempotency-key': randomUUID() },
            payload: { pageId: 'customers', text: 'Hide revenue', expectedGeneration: 1 },
          })
        ).statusCode,
      ).toBe(401);
      const login = await app.inject({
        method: 'POST',
        url: '/demo/session',
        headers: { origin: 'http://127.0.0.1:5173' },
        payload: { account: 'requester' },
      });
      const headers = {
        origin: 'http://127.0.0.1:5173',
        cookie: String(login.headers['set-cookie']).split(';')[0],
        'idempotency-key': randomUUID(),
      };
      const result = await app.inject({
        method: 'POST',
        url: '/v1/evolution-requests',
        headers,
        payload: {
          pageId: 'customers',
          text: 'Hide revenue',
          expectedGeneration: (
            await app.inject({
              method: 'GET',
              url: '/v1/configurations/active?pageId=customers',
              headers,
            })
          ).json().generation,
        },
      });
      expect(result.statusCode).toBe(202);
      const queued = result.json();
      expect(queued.status).toBe('Queued');
      await apiService.runPlannerOnce(localPlanner);
      const read = await app.inject({
        method: 'GET',
        url: `/v1/planner-jobs/${queued.jobId}`,
        headers,
      });
      expect(read.json()).toMatchObject({ status: 'Succeeded' });
      const preview = (
        await app.inject({
          method: 'GET',
          url: `/v1/proposals/${queued.proposalId}/preview`,
          headers,
        })
      ).json();
      const refinement = await app.inject({
        method: 'POST',
        url: `/v1/proposals/${queued.proposalId}/revisions`,
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload: {
          parentRevisionId: preview.revisionId,
          expectedLockVersion: preview.lockVersion,
          refinement: 'Show revenue',
        },
      });
      expect(refinement.statusCode).toBe(202);
      await apiService.runPlannerOnce(localPlanner);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/planner-jobs/${refinement.json().jobId}`,
            headers,
          })
        ).json().status,
      ).toBe('Succeeded');
      expect(
        (await app.inject({ method: 'GET', url: '/v1/planner?pageId=customers', headers })).json(),
      ).toEqual({ mode: 'local' });
    } finally {
      await app.close();
    }
  });
  it('rolls back revision creation when completion audit insertion fails', async () => {
    const job = await enqueue();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".fail_planner_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType"='PlannerSucceeded' THEN RAISE EXCEPTION 'Injected completion failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER fail_planner_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_planner_audit()`,
    );
    try {
      await expect(service.runPlannerOnce(localPlanner)).rejects.toThrow();
      expect(await db.proposalRevision.count({ where: { proposalId: job.proposalId } })).toBe(0);
      expect((await service.getPlannerJob(requester, job.jobId)).status).toBe('Running');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_planner_audit ON "AuditEvent"');
      await db.$executeRawUnsafe(`DROP FUNCTION "${schema}".fail_planner_audit()`);
    }
  });
});

describe('PostgreSQL lifecycle and access controls', () => {
  it('rechecks approval permission after acquiring the transactional proposal lock', async () => {
    const draft = await create();
    const submitted = await service.submit(requester, draft.proposalId, action(draft));
    let calls = 0;
    const revocable = new EvolutionService(
      db,
      {
        ...authorization,
        async authorize(principal, permission, resource) {
          if (permission === 'evolution:approve' && ++calls > 1) return false;
          return authorization.authorize(principal, permission, resource);
        },
      },
      testRegistry,
    );
    await expect(
      revocable.approve(approver, draft.proposalId, action(submitted)),
    ).rejects.toMatchObject({ status: 403 });
    expect((await service.getRevision(requester, draft.proposalId)).state).toBe('PendingApproval');
    expect(await db.approval.findUnique({ where: { revisionId: draft.revisionId } })).toBeNull();
  });
  it('completes approval, atomic publish, reconnect and rollback with monotonically increasing generations', async () => {
    const initial = await service.getActive(requester, 'customers');
    const draft = await create();
    expect(draft.state).toBe('ReadyForPreview');
    expect((await service.getActive(requester, 'customers')).versionId).toBe(initial.versionId);
    const accepted = await approve(draft),
      activated = await publish(accepted);
    expect(activated.generation).toBe(2);
    const reconnectedDb = new PrismaClient({ datasources: { db: { url: url.href } } });
    try {
      const reconnected = new EvolutionService(reconnectedDb, authorization, testRegistry);
      expect(await reconnected.getActive(requester, 'customers')).toEqual(activated);
    } finally {
      await reconnectedDb.$disconnect();
    }
    const restored = await service.rollback(approver, {
      pageId: 'customers',
      targetVersionId: initial.versionId,
      expectedGeneration: 2,
      reason: 'Test restoration',
      idempotencyKey: randomUUID(),
    });
    expect(restored.versionId).toBe(initial.versionId);
    expect(restored.generation).toBe(3);
    expect((await service.getRevision(requester, draft.proposalId)).state).toBe('RolledBack');
    expect((await service.history(approver, 'customers')).activations.map((e) => e.kind)).toEqual([
      'rollback',
      'publish',
      'baseline',
    ]);
  });
  it('denies requesters approval/publication/rollback and logs denials', async () => {
    const draft = await create(),
      submitted = await service.submit(requester, draft.proposalId, action(draft));
    await expect(
      service.approve(requester, draft.proposalId, action(submitted)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.publish(requester, {
        revisionId: draft.revisionId,
        expectedGeneration: 1,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    const initial = await service.getActive(requester, 'customers');
    await expect(
      service.rollback(requester, {
        pageId: 'customers',
        targetVersionId: initial.versionId,
        expectedGeneration: 1,
        reason: 'Denied',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await service.auditEvents(approver, 'customers')).filter(
        (e) => e.eventType === 'PermissionDenied',
      ),
    ).toHaveLength(3);
  });
  it('rejects invalid schema/capabilities before recording a usable proposal', async () => {
    await expect(
      service.createRequest(requester, {
        pageId: 'customers',
        text: 'Unsafe',
        operations: [{ ...operation()[0], capabilityId: 'invented' }],
        expectedGeneration: 1,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow('Capability');
    expect(await service.listProposals(requester, 'customers')).toHaveLength(0);
    expect(
      (await service.auditEvents(approver, 'customers')).some(
        (e) => e.eventType === 'ValidationFailed',
      ),
    ).toBe(true);
  });
  it('prevents cross-tenant proposal reads, publication and rollback', async () => {
    const draft = await create();
    await expect(service.getRevision(foreign, draft.proposalId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.publish(foreign, {
        revisionId: draft.revisionId,
        expectedGeneration: 1,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    const initial = await service.getActive(requester, 'customers');
    await expect(
      service.rollback(foreign, {
        pageId: 'customers',
        targetVersionId: initial.versionId,
        expectedGeneration: 1,
        reason: 'Cross tenant',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('refines approved content into a new immutable revision without inheriting approval', async () => {
    const old = await approve(await create());
    const revised = await service.refine(requester, old.proposalId, {
      parentRevisionId: old.revisionId,
      expectedLockVersion: old.lockVersion,
      operations: operation(60),
      refinement: 'Use 60 days',
      idempotencyKey: randomUUID(),
    });
    expect(revised.revisionNumber).toBe(2);
    expect(revised.state).toBe('ReadyForPreview');
    expect((await service.getRevision(requester, old.proposalId, old.revisionId)).state).toBe(
      'Superseded',
    );
    await expect(publish(old)).rejects.toMatchObject({ status: 409 });
    expect(await db.approval.findUnique({ where: { revisionId: revised.revisionId } })).toBeNull();
  });
  it('rejects stale locks, forged hashes, rejected proposals and missing approval', async () => {
    const draft = await create();
    await expect(
      service.submit(requester, draft.proposalId, { ...action(draft), expectedLockVersion: 99 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.submit(requester, draft.proposalId, {
        ...action(draft),
        configurationHash: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(publish(draft)).rejects.toMatchObject({ status: 409 });
    const submitted = await service.submit(requester, draft.proposalId, action(draft));
    const rejected = await service.reject(approver, draft.proposalId, {
      ...action(submitted),
      reason: 'Rejected',
    });
    await expect(publish(rejected)).rejects.toMatchObject({ status: 409 });
  });
  it('allows only one publisher against a shared base generation', async () => {
    const a = await approve(await create(90)),
      b = await approve(await create(60));
    const results = await Promise.allSettled([publish(a), publish(b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await service.getActive(requester, 'customers')).generation).toBe(2);
    expect((await service.listProposals(approver, 'customers')).map((r) => r.state).sort()).toEqual(
      ['PublicationConflict', 'Published'],
    );
  });
  it('serializes approval/refinement races and keeps old approval unusable', async () => {
    const draft = await create(),
      submitted = await service.submit(requester, draft.proposalId, action(draft));
    await Promise.allSettled([
      service.approve(approver, submitted.proposalId, action(submitted)),
      service.refine(requester, submitted.proposalId, {
        parentRevisionId: submitted.revisionId,
        expectedLockVersion: submitted.lockVersion,
        operations: operation(60),
        refinement: 'Race refinement',
        idempotencyKey: randomUUID(),
      }),
    ]);
    const current = await service.getRevision(requester, draft.proposalId);
    if (current.revisionId !== submitted.revisionId) expect(current.state).toBe('ReadyForPreview');
    else expect(current.state).toBe('Approved');
    expect((await service.getActive(requester, 'customers')).generation).toBe(1);
  });
  it('returns exact idempotent results and rejects reuse with different content', async () => {
    const key = randomUUID(),
      input = {
        pageId: 'customers',
        text: 'Idempotent',
        operations: operation(),
        expectedGeneration: 1,
        idempotencyKey: key,
      };
    const first = await service.createRequest(requester, input);
    expect(await service.createRequest(requester, input)).toEqual(first);
    await expect(
      service.createRequest(requester, { ...input, text: 'Different' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const approved = await approve(first),
      publishKey = randomUUID(),
      published = await publish(approved, publishKey);
    expect(await publish(approved, publishKey)).toEqual(published);
    expect((await service.history(approver, 'customers')).activations).toHaveLength(2);
  });
  it('enforces content immutability, state transitions and composite foreign keys in PostgreSQL', async () => {
    const draft = await create();
    await expect(
      db.proposalRevision.update({
        where: { id: draft.revisionId },
        data: { configurationHash: '0'.repeat(64) },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      db.revisionLifecycle.update({
        where: { revisionId: draft.revisionId },
        data: { state: 'Approved', lockVersion: 1 },
      }),
    ).rejects.toThrow('Illegal lifecycle');
    const foreignBase = await service.getActive(foreign, 'customers');
    await expect(
      db.configurationVersion.create({
        data: {
          id: randomUUID(),
          applicationId: requester.principal.applicationId,
          tenantId: requester.principal.tenantId,
          pageId: 'customers',
          registryVersionId: service.registryVersionId,
          parentVersionId: foreignBase.versionId,
          configuration: JSON.parse(JSON.stringify(draft.configuration)),
          configurationHash: contentHash(draft.configuration),
          createdBy: 'test',
        },
      }),
    ).rejects.toThrow();
  });
  it('rolls back every publication write if its transactional audit insert fails', async () => {
    const approved = await approve(await create());
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_publish_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType"='Published' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER test_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION fail_publish_audit()',
    );
    try {
      await expect(publish(approved)).rejects.toThrow('Injected audit failure');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_audit_failure ON "AuditEvent"');
      await db.$executeRawUnsafe('DROP FUNCTION fail_publish_audit()');
    }
    expect((await service.getActive(requester, 'customers')).generation).toBe(1);
    expect((await service.history(approver, 'customers')).versions).toHaveLength(1);
    expect((await service.getRevision(requester, approved.proposalId)).state).toBe('Approved');
    expect((await publish(approved)).generation).toBe(2);
  });
  it('serializes competing rollback and publication without losing history', async () => {
    const initial = await service.getActive(requester, 'customers');
    await publish(await approve(await create(90)));
    const next = await approve(await create(60));
    const results = await Promise.allSettled([
      publish(next),
      service.rollback(approver, {
        pageId: 'customers',
        targetVersionId: initial.versionId,
        expectedGeneration: 2,
        reason: 'Race',
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await service.getActive(requester, 'customers')).generation).toBe(3);
    expect((await service.history(approver, 'customers')).activations).toHaveLength(3);
  });
  it('enforces authenticated HTTP transport, origin checks and server-owned role mappings', async () => {
    const { app } = await createDemoApi({
      databaseUrl: url.href,
      sessionSecret: 'test-secret-with-at-least-32-characters',
    });
    const origin = 'http://127.0.0.1:5173';
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/v1/configurations/active?pageId=customers' }))
          .statusCode,
      ).toBe(401);
      const login = await app.inject({
        method: 'POST',
        url: '/demo/session',
        headers: { origin },
        payload: { account: 'requester' },
      });
      expect(login.statusCode).toBe(200);
      const cookieHeader = String(login.headers['set-cookie']).split(';')[0];
      const headers = {
        origin,
        cookie: cookieHeader,
        'idempotency-key': randomUUID(),
        'x-role': 'approver',
      };
      const saved = await app.inject({
        method: 'POST',
        url: '/v1/evolution-requests',
        headers,
        payload: {
          pageId: 'customers',
          text: 'HTTP request',
          operations: operation(),
          expectedGeneration: (
            await app.inject({
              method: 'GET',
              url: '/v1/configurations/active?pageId=customers',
              headers,
            })
          ).json().generation,
        },
      });
      expect(saved.statusCode).toBe(201);
      const rev = saved.json<RevisionEnvelope>();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/proposals/${rev.proposalId}/approve`,
            headers,
            payload: action(rev),
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/demo/session',
            payload: { account: 'approver' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/evolution-requests',
            headers,
            payload: {
              pageId: 'customers',
              text: 'Cross tenant',
              operations: operation(),
              expectedGeneration: 1,
              tenantId: 'foreign',
            },
          })
        ).statusCode,
      ).toBe(422);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/evolution-requests',
            headers: { ...headers, 'idempotency-key': randomUUID() },
            payload: { pageId: 'customers', text: 'Hide revenue', expectedGeneration: 1 },
          })
        ).statusCode,
      ).toBe(503);
      const active = await app.inject({
        method: 'GET',
        url: '/v1/configurations/active?pageId=customers',
        headers,
      });
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/v1/configurations/active?pageId=customers',
            headers: { ...headers, 'if-none-match': String(active.headers.etag) },
          })
        ).statusCode,
      ).toBe(304);
    } finally {
      await app.close();
    }
  });
});
