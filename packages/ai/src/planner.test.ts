import { describe, expect, it, vi } from 'vitest';
import { applyOperations } from '@evolvekit/core';
import { GeminiPlanner, LocalRulesPlanner, parseCandidate, type PlannerInput } from './index';
import { page, baseline, legacyRegistry } from '../../../apps/demo-erp/src/fixtures';
const input: PlannerInput = {
  request: 'Show customers with no purchase in 90 days and hide revenue',
  page: { pageId: page.pageId, fields: page.fields, operations: page.operations },
  baseConfiguration: baseline,
};
const signal = () => new AbortController().signal;
const local = new LocalRulesPlanner();
const runtime = {
  kind: 'runtime',
  summary: 'Hide revenue',
  operations: [
    {
      capabilityId: 'customer-visibility',
      kind: 'set_column_visibility' as const,
      fieldId: 'revenue',
      visible: false,
    },
  ],
};
const response = (value: unknown, finishReason = 'STOP') =>
  new Response(
    JSON.stringify({
      candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }],
    }),
  );
const wire = { ...runtime, reason: '', missingCapabilities: [] };

describe('planner contract and no-cost local mode', () => {
  it('handles the exact uppercase column rename and replaces the label on refinement', async () => {
    const first = parseCandidate(
      await local.generate({ ...input, request: 'RENAME THE REVENUE COLUMN TO AMOUNT' }, signal()),
    );
    expect(first).toMatchObject({
      kind: 'runtime',
      operations: [{ kind: 'set_column_label', fieldId: 'revenue', label: 'AMOUNT' }],
    });
    if (first.kind !== 'runtime') throw new Error('Expected runtime');
    const renamed = applyOperations(baseline, first.operations, page);
    const second = parseCandidate(
      await local.generate(
        { ...input, baseConfiguration: renamed, request: 'Rename the Amount column to Total' },
        signal(),
      ),
    );
    expect(second).toMatchObject({
      kind: 'runtime',
      operations: [{ kind: 'set_column_label', fieldId: 'revenue', label: 'Total' }],
    });
    const unsupported = parseCandidate(
      await local.generate(
        { ...input, page: legacyRegistry.pages[0], request: 'Rename the revenue column to Amount' },
        signal(),
      ),
    );
    expect(unsupported.kind).toBe('unsupported');
  });
  it('assembles the registered follow-up workflow without generating fields or code', async () => {
    const candidate = parseCandidate(
      await local.generate(
        {
          ...input,
          page: { ...input.page, features: page.features },
          request: 'Add customer follow-ups',
        },
        signal(),
      ),
    );
    expect(candidate).toMatchObject({
      kind: 'runtime',
      operations: [{ kind: 'set_feature', featureId: 'customer-followups', enabled: true }],
    });
    if (candidate.kind !== 'runtime') throw new Error('Expected runtime');
    expect(applyOperations(baseline, candidate.operations, page).enabledFeatures).toEqual([
      'customer-followups',
    ]);
  });
  it('moves and renames a button with local rules and preserves its position during refinement', async () => {
    const actionInput = {
      ...input,
      page: { ...input.page, actions: page.actions },
      request: 'Move the Add Customer button above the table and rename it New Customer',
    };
    const first = parseCandidate(await local.generate(actionInput, signal()));
    expect(first).toMatchObject({
      kind: 'runtime',
      operations: [
        {
          kind: 'set_action',
          actionId: 'add-customer',
          label: 'New Customer',
          position: 'above_table',
        },
      ],
    });
    if (first.kind !== 'runtime') throw new Error('Expected runtime');
    const second = parseCandidate(
      await local.generate(
        {
          ...actionInput,
          request: 'rename Add Customer to Create Customer',
          previousOperations: first.operations,
        },
        signal(),
      ),
    );
    expect(second).toMatchObject({
      kind: 'runtime',
      operations: [{ kind: 'set_action', label: 'Create Customer', position: 'above_table' }],
    });
    expect(applyOperations(baseline, first.operations, page).actions?.[0].position).toBe(
      'above_table',
    );
  });
  it('formats revenue and replaces only its formatting operation on refinement', async () => {
    const first = await local.generate(
      { ...input, request: 'add comma in revenue amount' },
      signal(),
    );
    expect(first).toMatchObject({
      kind: 'runtime',
      operations: [{ kind: 'set_number_format', fieldId: 'revenue', format: 'indian' }],
    });
    if (first.kind !== 'runtime') throw new Error('Expected runtime');
    const refined = await local.generate(
      {
        ...input,
        request: 'format revenue with international commas',
        previousOperations: [...first.operations, ...runtime.operations],
      },
      signal(),
    );
    expect(refined).toMatchObject({
      kind: 'runtime',
      operations: [
        { kind: 'set_number_format', format: 'international' },
        { kind: 'set_column_visibility', visible: false },
      ],
    });
    const plain = await local.generate(
      { ...input, request: 'remove commas from revenue' },
      signal(),
    );
    expect(plain).toMatchObject({
      kind: 'runtime',
      operations: [{ kind: 'set_number_format', format: 'plain' }],
    });
  });
  it('interprets compound supported commands and produces valid complete configuration', async () => {
    const value = await local.generate(input, signal());
    expect(value.kind).toBe('runtime');
    if (value.kind !== 'runtime') throw new Error('Expected operations');
    const configuration = applyOperations(baseline, value.operations, page);
    expect(configuration.filters[0]).toMatchObject({ fieldId: 'lastPurchaseAt', value: 90 });
    expect(configuration.columns.find((c) => c.fieldId === 'revenue')?.visible).toBe(false);
  });
  it('never partially fulfills a request with unsupported suffixes', async () => {
    const value = await local.generate(
      { ...input, request: 'Hide revenue and delete all customers' },
      signal(),
    );
    expect(value.kind).toBe('unsupported');
    expect(value).not.toHaveProperty('operations');
  });
  it.each([
    'Hide salary',
    'Filter last purchase older than 9000 days',
    'Reorder columns revenue, region',
  ])('asks for detail rather than inventing fields/values: %s', async (request) => {
    expect((await local.generate({ ...input, request }, signal())).kind).toBe('clarification');
  });
  it('rejects ambiguous date-field selection', async () => {
    const value = await local.generate(
      {
        ...input,
        page: {
          ...input.page,
          fields: [...page.fields, { ...page.fields[3], id: 'otherDate', label: 'Other date' }],
        },
      },
      signal(),
    );
    expect(value.kind).toBe('clarification');
  });
  it('preserves existing revision operations when refining', async () => {
    const first = await local.generate(input, signal());
    if (first.kind !== 'runtime') throw new Error('Expected runtime');
    const next = await local.generate(
      {
        ...input,
        request: 'Filter last purchase older than 30 days',
        previousOperations: first.operations,
      },
      signal(),
    );
    if (next.kind !== 'runtime') throw new Error('Expected runtime');
    expect(next.operations).toHaveLength(2);
    expect(next.operations.find((op) => op.kind === 'add_filter')).toMatchObject({
      filter: { value: 30 },
    });
    expect(next.operations.find((op) => op.kind === 'set_column_visibility')).toMatchObject({
      fieldId: 'revenue',
      visible: false,
    });
  });
  it('rejects code, forged structure and oversized operation lists', () => {
    expect(() => parseCandidate({ ...runtime, publish: true })).toThrow('INVALID_CANDIDATE');
    expect(() =>
      parseCandidate({
        ...runtime,
        operations: [{ ...runtime.operations[0], script: 'alert(1)' }],
      }),
    ).toThrow('INVALID_CANDIDATE');
    expect(() =>
      parseCandidate({ ...runtime, operations: Array(33).fill(runtime.operations[0]) }),
    ).toThrow('INVALID_CANDIDATE');
  });
});
describe('Gemini transport', () => {
  it('explains unregistered number formatting without a model call or partial changes', async () => {
    const transport = vi.fn<typeof fetch>();
    const planner = new GeminiPlanner({ apiKey: 'test', fetch: transport });
    for (const request of [
      'add comma in revenue amount',
      'Hide revenue and add commas to amounts',
    ]) {
      const candidate = await planner.generate(
        { ...input, page: legacyRegistry.pages[0], request },
        signal(),
      );
      expect(candidate).toMatchObject({
        kind: 'unsupported',
        missingCapabilities: ['number_formatting'],
      });
      expect(candidate).not.toHaveProperty('operations');
      expect(
        await local.generate({ ...input, page: legacyRegistry.pages[0], request }, signal()),
      ).toMatchObject({
        kind: 'unsupported',
        missingCapabilities: ['number_formatting'],
      });
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it('sends schema and allowlisted inputs with a header key, and parses the response', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(wire));
    const planner = new GeminiPlanner({
      apiKey: 'test-secret',
      model: 'gemini-3.8-flash',
      fetch: transport,
    });
    expect(await planner.generate(input, signal())).toEqual(runtime);
    const [url, options] = transport.mock.calls[0];
    expect(String(url)).not.toContain('test-secret');
    const body = JSON.parse(String(options?.body));
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toMatchObject({ type: 'object' });
    expect(JSON.stringify(body.generationConfig.responseJsonSchema)).not.toContain('maxItems');
    const formatting =
      body.generationConfig.responseJsonSchema.properties.operations.items.anyOf.find(
        (schema: any) => schema.properties.kind.enum.includes('set_number_format'),
      );
    expect(formatting.required).toContain('format');
    expect(formatting.properties.format.enum).toEqual(['plain', 'indian', 'international']);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(JSON.parse(body.contents[0].parts[0].text)).not.toHaveProperty('rows');
    expect(options?.headers).toMatchObject({ 'x-goog-api-key': 'test-secret' });
  });
  it('does not send Gemini 3 thinking levels to older configurable models', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(wire));
    await new GeminiPlanner({
      apiKey: 'test',
      model: 'gemini-2.5-flash',
      fetch: transport,
    }).generate(input, signal());
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.generationConfig).not.toHaveProperty('thinkingConfig');
  });
  it('accepts unsupported/clarification results without operations', async () => {
    for (const kind of ['unsupported', 'clarification']) {
      const planner = new GeminiPlanner({
        apiKey: 'test',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          response({
            kind,
            summary: '',
            reason: 'No matching capability',
            operations: [],
            missingCapabilities: [],
          }),
        ),
      });
      expect(await planner.generate(input, signal())).toMatchObject({
        kind,
        reason: 'No matching capability',
      });
    }
  });
  it.each([
    [429, 'PROVIDER_QUOTA', true],
    [403, 'PROVIDER_AUTH', false],
    [503, 'PROVIDER_ERROR', true],
  ])('redacts HTTP %s provider errors', async (status, code, retryable) => {
    const planner = new GeminiPlanner({
      apiKey: 'test',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('secret provider body', { status: Number(status) })),
    });
    await expect(planner.generate(input, signal())).rejects.toMatchObject({
      code,
      retryable,
      message: code,
    });
  });
  it.each(['MAX_TOKENS', 'SAFETY'])(
    'rejects incomplete/refused output: %s',
    async (finishReason) => {
      const planner = new GeminiPlanner({
        apiKey: 'test',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response(wire, finishReason)),
      });
      await expect(planner.generate(input, signal())).rejects.toHaveProperty('code');
    },
  );
  it('rejects malformed JSON and oversized responses', async () => {
    for (const value of ['not-json', 'x'.repeat(262145)]) {
      const planner = new GeminiPlanner({
        apiKey: 'test',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(value)),
      });
      await expect(planner.generate(input, signal())).rejects.toHaveProperty('code');
    }
  });
  it('returns a bounded timeout code when transport aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const planner = new GeminiPlanner({
      apiKey: 'test',
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('aborted secret')),
    });
    await expect(planner.generate(input, controller.signal)).rejects.toMatchObject({
      code: 'PLANNER_TIMEOUT',
      retryable: true,
    });
  });
});
