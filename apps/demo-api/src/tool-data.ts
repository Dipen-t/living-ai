import type { DemoSession, ToolDataSource } from '@evolvekit/core';
import { contentHash, EvolutionError } from '@evolvekit/server';
import { customers, orders } from '../../demo-erp/src/fixtures';

const definitions = [
  {
    id: 'orders',
    label: 'Orders',
    fields: [
      { id: 'orderNumber', label: 'Order number', type: 'string' as const },
      { id: 'customer', label: 'Customer', type: 'string' as const },
      { id: 'status', label: 'Order status', type: 'string' as const },
      { id: 'amount', label: 'Order amount', type: 'number' as const },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    fields: [
      { id: 'name', label: 'Customer name', type: 'string' as const },
      { id: 'company', label: 'Company', type: 'string' as const },
      { id: 'region', label: 'Region', type: 'string' as const },
      { id: 'revenue', label: 'Revenue', type: 'number' as const },
    ],
  },
];
export const toolDataSources: ToolDataSource[] = definitions.map((source) => ({
  ...source,
  version: contentHash({ ...source, contractVersion: 1 }),
}));
function authorize(identity: DemoSession) {
  if (
    !identity.permissions.includes('code:data') ||
    identity.principal.applicationId !== 'demo-erp' ||
    identity.principal.tenantId !== 'demo-org'
  )
    throw new EvolutionError(
      403,
      'DATA_FORBIDDEN',
      'These workspace records are not available to this account.',
    );
}
export function toolDataSource(identity: DemoSession, sourceId: string) {
  authorize(identity);
  const source = toolDataSources.find((source) => source.id === sourceId);
  if (!source)
    throw new EvolutionError(422, 'DATA_SOURCE', 'Choose a registered workspace data source.');
  return source;
}
export function toolDataChoices(identity: DemoSession, sourceId: string) {
  toolDataSource(identity, sourceId);
  return (sourceId === 'orders' ? orders : customers).map((row) => ({
    id: String(row.id),
    label:
      sourceId === 'orders'
        ? `${row.orderNumber} · ${row.customer}`
        : `${row.name} · ${row.company}`,
  }));
}
export function toolDataRow(identity: DemoSession, sourceId: string, recordId: string) {
  const source = toolDataSource(identity, sourceId);
  const row = (sourceId === 'orders' ? orders : customers).find((row) => row.id === recordId);
  if (!row)
    throw new EvolutionError(
      404,
      'DATA_RECORD',
      'This workspace record is unavailable. Choose another record.',
    );
  return Object.fromEntries(source.fields.map((field) => [field.id, row[field.id]]));
}
