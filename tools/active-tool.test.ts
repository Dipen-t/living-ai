import { describe, expect, it } from 'vitest';
import Fastify from '../apps/demo-api/node_modules/fastify/fastify.js';
import type { PrismaClient } from '@prisma/client';
import { registerCodeRoutes } from '../apps/demo-api/src/code';
import { demoAccounts } from '../apps/demo-api/src/app';
import { discountExample, toolReviewContent } from '@evolvekit/core';
import { contentHash, EvolutionError } from '@evolvekit/server';
import { toolDataSources } from '../apps/demo-api/src/tool-data';

async function setup() {
  const id = '11111111-1111-4111-8111-111111111111';
  let active = { proposalId: id as string | null, generation: 4 };
  const source = toolDataSources.find((source) => source.id === 'orders')!;
  const binding = {
    sourceId: 'orders',
    sourceVersion: source.version,
    mappings: [{ inputId: 'orderAmount', fieldId: 'amount' }],
  };
  const proposal = {
    id,
    state: 'Published',
    binding,
    source: discountExample.draft,
    cases: discountExample.cases,
    request: discountExample.request,
    summary: 'Discount tool',
    contentHash: contentHash(
      toolReviewContent(
        discountExample.draft,
        discountExample.cases,
        discountExample.request,
        binding,
      ),
    ),
  };
  let calls = 0,
    changeDuringRun = false;
  const db = {
    codeActive: { upsert: async () => ({ ...active }) },
    codeProposal: { findFirst: async () => proposal },
  } as unknown as PrismaClient;
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(error instanceof EvolutionError ? error.status : 500)
      .send({ message: error.message }),
  );
  await registerCodeRoutes(
    app,
    db,
    () => demoAccounts.requester,
    {
      async baseCommit() {
        return 'a'.repeat(40);
      },
      async generate() {
        throw new Error('Unexpected generation');
      },
      async evaluate(_draft, _cases, _request, input) {
        calls++;
        if (changeDuringRun) active = { ...active, generation: active.generation + 1 };
        return {
          result: { eligible: true, discountPercent: 10, reason: 'Gold customer discount' },
          preview: '<div>Gold customer discount</div>',
        };
      },
    },
    false,
  );
  return {
    app,
    id,
    proposal,
    get calls() {
      return calls;
    },
    setChanged(value: boolean) {
      changeDuringRun = value;
    },
    rollback() {
      active = { proposalId: null, generation: 5 };
    },
  };
}
describe('active order tool transport', () => {
  it('returns only the active tool metadata and hides actions after rollback', async () => {
    const fixture = await setup();
    try {
      const response = (await fixture.app.inject('/v1/code-tools/active?sourceId=orders')).json();
      expect(response.tool.id).toBe(fixture.id);
      expect(response.tool.source).not.toHaveProperty('files');
      expect(
        (await fixture.app.inject('/v1/code-tools/active?sourceId=customers')).json().tool,
      ).toBeNull();
      fixture.rollback();
      expect(
        (await fixture.app.inject('/v1/code-tools/active?sourceId=orders')).json().tool,
      ).toBeNull();
    } finally {
      await fixture.app.close();
    }
  });
  it('rejects a stale panel before execution and a changed active version after execution', async () => {
    const fixture = await setup();
    const payload = {
      proposalId: null,
      recordId: 'o1',
      input: { customerTier: 'gold', overdue: false },
      expectedActive: { proposalId: fixture.id, generation: 3 },
    };
    const run = () => fixture.app.inject({ method: 'POST', url: '/v1/code-evaluate', payload });
    try {
      expect((await run()).statusCode).toBe(409);
      expect(fixture.calls).toBe(0);
      payload.expectedActive.generation = 4;
      const response = await run();
      expect(response.statusCode).toBe(200);
      expect(response.json().effectiveInput.orderAmount).toBe(184000);
      fixture.setChanged(true);
      expect((await run()).statusCode).toBe(409);
    } finally {
      await fixture.app.close();
    }
  });
});
