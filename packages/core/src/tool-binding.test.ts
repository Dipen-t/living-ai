import { describe, it, expect } from 'vitest';
import type { ToolRecord } from './generated-tools';
import {
  resolveToolInput,
  validateToolBinding,
  toolReviewContent,
  type ToolDataSource,
} from './tool-binding';
const source: ToolDataSource = {
  id: 'orders',
  label: 'Orders',
  version: 'a'.repeat(64),
  fields: [
    { id: 'amount', label: 'Order amount', type: 'number' },
    { id: 'customer', label: 'Customer', type: 'string' },
  ],
};
const binding = {
  sourceId: 'orders',
  sourceVersion: source.version,
  mappings: [{ inputId: 'orderAmount', fieldId: 'amount' }],
};
const example = { orderAmount: 1000, overdue: false };
describe('approved host data bindings', () => {
  it('reads mapped values and keeps unrelated row data out of execution', () => {
    const row = { amount: 184000, privateNotes: 'Do not expose', customer: 'Company' };
    expect(resolveToolInput(binding, example, source, { overdue: false }, row)).toEqual({
      overdue: false,
      orderAmount: 184000,
    });
    expect(row.amount).toBe(184000);
  });
  it('rejects overrides, missing values, extra fields and incompatible types', () => {
    const invalidManual: ToolRecord[] = [
      { orderAmount: 5, overdue: false },
      {},
      { overdue: 'false' },
      { overdue: false, extra: 1 },
    ];
    for (const manual of invalidManual)
      expect(() => resolveToolInput(binding, example, source, manual, { amount: 1 })).toThrow();
    expect(() =>
      resolveToolInput(binding, example, source, { overdue: false }, { amount: null }),
    ).toThrow();
  });
  it('rejects stale source versions, unknown fields and repeated input mappings', () => {
    for (const changed of [
      { ...binding, sourceVersion: 'b'.repeat(64) },
      { ...binding, mappings: [{ inputId: 'orderAmount', fieldId: 'privateNotes' }] },
      { ...binding, mappings: [...binding.mappings, ...binding.mappings] },
      { ...binding, mappings: [{ inputId: 'overdue', fieldId: 'amount' }] },
    ])
      expect(() => validateToolBinding(changed, example, source)).toThrow();
  });
  it('preserves old source hashes and includes data mapping in new review content', () => {
    expect(toolReviewContent('source', [], 'request', null)).toEqual({
      draft: 'source',
      cases: [],
      request: 'request',
    });
    expect(toolReviewContent('source', [], 'request', binding)).toHaveProperty('binding', binding);
  });
});
