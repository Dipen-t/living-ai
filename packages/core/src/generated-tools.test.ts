import { describe, it, expect } from 'vitest';
import { matchesToolContract, toolCasesSchema, toolRecordSchema } from './generated-tools';

const cases = [true, false, true].map((flag) => ({
  input: { tier: 'gold', amount: 10000, flag },
  expected: { allowed: flag, reason: flag ? 'Approved' : 'Blocked', rate: flag ? 10 : 0 },
}));
describe('generated business tool contracts', () => {
  it('accepts text, numeric and yes/no decisions without coercion', () => {
    expect(toolCasesSchema.parse(cases)).toEqual(cases);
    expect(matchesToolContract({ flag: 'false' }, { flag: false })).toBe(false);
    expect(matchesToolContract({ flag: false }, { flag: false })).toBe(true);
  });
  it.each<unknown>([
    null,
    [],
    {},
    { x: { nested: 1 } },
    { x: Infinity },
    { x: 'a'.repeat(501) },
    { constructor: 1 },
  ])('rejects unbounded or unsupported values: %j', (record) => {
    expect(toolRecordSchema.safeParse(record).success).toBe(false);
  });
  it('rejects inconsistent input or output fields and types across examples', () => {
    for (const side of ['input', 'expected'] as const) {
      const changed = structuredClone(cases);
      (changed[1] as Record<string, unknown>)[side] = { different: true };
      expect(toolCasesSchema.safeParse(changed).success).toBe(false);
    }
    const changed = structuredClone(cases);
    (changed[1].input as Record<string, unknown>).flag = 'false';
    expect(toolCasesSchema.safeParse(changed).success).toBe(false);
  });
  it('preserves text for safe rendering and rejects extra runtime fields', () => {
    const text = '<script> & "quoted"';
    expect(toolRecordSchema.parse({ reason: text })).toEqual({ reason: text });
    expect(matchesToolContract({ amount: 5, extra: true }, { amount: 1 })).toBe(false);
    expect(matchesToolContract({ amount: 5 }, { amount: 1 })).toBe(true);
  });
});
