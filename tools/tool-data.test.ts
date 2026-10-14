import { describe, it, expect } from 'vitest';
import { demoAccounts } from '../apps/demo-api/src/app';
import { toolDataChoices, toolDataRow, toolDataSources } from '../apps/demo-api/src/tool-data';
describe('registered read-only demo data', () => {
  it('lists stable choices and exposes only registered fields', () => {
    expect(toolDataChoices(demoAccounts.requester, 'orders')[0]).toMatchObject({ id: 'o1' });
    expect(toolDataRow(demoAccounts.requester, 'orders', 'o1')).toEqual({
      orderNumber: 'ORD-1001',
      customer: 'Northline Textiles',
      status: 'Pending',
      amount: 184000,
    });
    expect(toolDataRow(demoAccounts.requester, 'customers', 'c1')).not.toHaveProperty(
      'lastPurchaseAt',
    );
    expect(toolDataSources[0].version).toMatch(/^[a-f0-9]{64}$/);
  });
  it('denies other tenants and accounts without data permission', () => {
    for (const identity of [
      {
        ...demoAccounts.requester,
        principal: { ...demoAccounts.requester.principal, tenantId: 'foreign' },
      },
      {
        ...demoAccounts.requester,
        permissions: demoAccounts.requester.permissions.filter(
          (permission) => permission !== 'code:data',
        ),
      },
    ])
      expect(() => toolDataChoices(identity, 'orders')).toThrow('not available');
  });
  it('rejects unknown sources and guessed records', () => {
    expect(() => toolDataChoices(demoAccounts.requester, 'private')).toThrow();
    expect(() => toolDataRow(demoAccounts.requester, 'orders', 'foreign-id')).toThrow();
  });
});
