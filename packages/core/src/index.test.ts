import { describe, expect, it } from 'vitest';
import {
  applyOperations,
  buildTableModel,
  canonicalize,
  isAdditiveRegistryChange,
  selectSavedView,
  validateConfiguration,
  validateOperations,
  validateRegistry,
  resolveActions,
  type RuntimeOperation,
} from './index';
import {
  baseline,
  customers,
  evaluationTime,
  page,
  registry,
  legacyRegistry,
  numberFormatRegistry,
  ordersRegistry,
  actionRegistry,
  followUpsRegistry,
} from '../../../apps/demo-erp/src/fixtures';

describe('column labels', () => {
  const rename = {
    capabilityId: 'customers-column-labels',
    kind: 'set_column_label',
    fieldId: 'revenue',
    label: 'Amount',
  };
  it('renames headings and saved views without changing data or the base', () => {
    const config = applyOperations(baseline, [rename], page);
    const model = buildTableModel(customers, config, page, { evaluationTime });
    expect(model.columns.find((field) => field.id === 'revenue')?.label).toBe('Amount');
    expect(model.rows).toEqual(customers);
    expect(baseline.columns.find((field) => field.fieldId === 'revenue')).not.toHaveProperty(
      'label',
    );
    const saved = {
      ...config,
      savedViews: [
        {
          id: 'renamed',
          name: 'Renamed',
          configuration: { columns: config.columns, filters: [], sort: [] },
        },
      ],
    };
    expect(
      selectSavedView(saved, 'renamed').columns.find((field) => field.fieldId === 'revenue')?.label,
    ).toBe('Amount');
    expect(isAdditiveRegistryChange(followUpsRegistry, registry)).toBe(true);
  });
  it('rejects unregistered renaming, unknown fields and empty or oversized labels', () => {
    expect(validateOperations([rename], followUpsRegistry.pages[0]).success).toBe(false);
    expect(validateOperations([{ ...rename, fieldId: 'unknown' }], page).success).toBe(false);
    for (const label of [' ', 'x'.repeat(121)])
      expect(validateOperations([{ ...rename, label }], page).success).toBe(false);
    const config = applyOperations(baseline, [rename], page);
    expect(validateConfiguration(config, followUpsRegistry.pages[0]).success).toBe(false);
    expect(canonicalize(validateConfiguration(baseline, page).success && baseline)).toBe(
      canonicalize(baseline),
    );
  });
});

describe('number formatting contract', () => {
  it('allows new pages while preserving every existing page contract', () => {
    expect(isAdditiveRegistryChange(numberFormatRegistry, registry)).toBe(true);
    expect(isAdditiveRegistryChange(registry, numberFormatRegistry)).toBe(false);
    const removed = structuredClone(registry);
    removed.pages = removed.pages.filter((page) => page.pageId !== 'customers');
    expect(isAdditiveRegistryChange(numberFormatRegistry, removed)).toBe(false);
  });
  const format: RuntimeOperation = {
    capabilityId: 'customer-number-format',
    kind: 'set_number_format',
    fieldId: 'revenue',
    format: 'international',
  };
  it('persists formatting without mutating the base, numbers, sorting, or filters', () => {
    const config = applyOperations(baseline, [format], page);
    expect(config.columns.find((column) => column.fieldId === 'revenue')?.numberFormat).toBe(
      'international',
    );
    expect(baseline.columns.find((column) => column.fieldId === 'revenue')).not.toHaveProperty(
      'numberFormat',
    );
    expect(buildTableModel(customers, config, page, { evaluationTime }).rows).toEqual(customers);
    const saved = {
      ...config,
      savedViews: [
        {
          id: 'formatted',
          name: 'Formatted',
          configuration: { columns: config.columns, filters: [], sort: [] },
        },
      ],
    };
    expect(selectSavedView(saved, 'formatted').columns).toEqual(config.columns);
  });
  it('rejects unregistered formatting, string fields, forged formats, and arbitrary code', () => {
    expect(validateOperations([format], legacyRegistry.pages[0]).success).toBe(false);
    expect(validateOperations([{ ...format, fieldId: 'name' }], page).success).toBe(false);
    expect(validateOperations([{ ...format, format: 'eval(1)' }], page).success).toBe(false);
    expect(validateOperations([{ ...format, script: 'alert(1)' }], page).success).toBe(false);
    const config = applyOperations(baseline, [format], page);
    expect(validateConfiguration(config, legacyRegistry.pages[0]).success).toBe(false);
  });
  it('accepts an additive operation upgrade but rejects changed fields or baseline', () => {
    expect(isAdditiveRegistryChange(legacyRegistry, registry)).toBe(true);
    const broken = structuredClone(registry);
    broken.pages[0].fields[0].label = 'Changed';
    expect(isAdditiveRegistryChange(legacyRegistry, broken)).toBe(false);
    const narrowed = structuredClone(registry);
    narrowed.pages[0].operations[0].allowedFieldIds = [];
    expect(isAdditiveRegistryChange(legacyRegistry, narrowed)).toBe(false);
  });
});
describe('page button contract', () => {
  it('activates only registered workflows and preserves the original configuration for rollback', () => {
    const operation = {
      kind: 'set_feature',
      capabilityId: 'customer-followups-workflow',
      featureId: 'customer-followups',
      enabled: true,
    };
    const enabled = applyOperations(baseline, [operation], page);
    expect(enabled.enabledFeatures).toEqual(['customer-followups']);
    expect(baseline).not.toHaveProperty('enabledFeatures');
    expect(validateOperations([operation], actionRegistry.pages[0]).success).toBe(false);
    expect(validateOperations([{ ...operation, featureId: 'arbitrary-code' }], page).success).toBe(
      false,
    );
    expect(
      validateConfiguration(
        { ...enabled, enabledFeatures: ['customer-followups', 'customer-followups'] },
        page,
      ).success,
    ).toBe(false);
    expect(isAdditiveRegistryChange(actionRegistry, registry)).toBe(true);
    expect(
      applyOperations(enabled, [{ ...operation, enabled: false }], page).enabledFeatures,
    ).toEqual([]);
  });
  const operation: RuntimeOperation = {
    kind: 'set_action',
    capabilityId: 'customer-action-layout',
    actionId: 'add-customer',
    label: 'New Customer',
    position: 'above_table',
  };
  it('resolves legacy defaults without rewriting their JSON and applies immutable changes', () => {
    const original = canonicalize(baseline);
    expect(resolveActions(baseline, page)).toEqual([
      { actionId: 'add-customer', label: 'Add Customer', position: 'page_header' },
    ]);
    const changed = applyOperations(baseline, [operation], page);
    expect(resolveActions(changed, page)).toEqual([
      { actionId: 'add-customer', label: 'New Customer', position: 'above_table' },
    ]);
    expect(canonicalize(baseline)).toBe(original);
    expect(changed.columns).toEqual(baseline.columns);
  });
  it('rejects unknown buttons, arbitrary positions, handler changes, empty changes, and duplicate buttons', () => {
    for (const value of [
      { ...operation, actionId: 'delete-all' },
      { ...operation, position: 'absolute' },
      { ...operation, handlerId: 'delete-all' },
      { kind: 'set_action', capabilityId: operation.capabilityId, actionId: operation.actionId },
    ])
      expect(validateOperations([value], page).success).toBe(false);
    expect(validateOperations([operation], registry.pages[1]).success).toBe(false);
    const config = applyOperations(baseline, [operation], page);
    expect(
      validateConfiguration({ ...config, actions: [...config.actions!, ...config.actions!] }, page)
        .success,
    ).toBe(false);
  });
  it('allows explicit action registration but rejects changed existing handlers or position contracts', () => {
    expect(isAdditiveRegistryChange(ordersRegistry, registry)).toBe(true);
    const changed = structuredClone(registry);
    changed.pages[0].actions![0].handlerId = 'delete-customers';
    expect(isAdditiveRegistryChange(registry, changed)).toBe(false);
  });
});

const inactivity: RuntimeOperation = {
  capabilityId: 'customer-filter',
  kind: 'add_filter',
  filter: {
    id: 'inactive',
    label: 'Inactive customers',
    fieldId: 'lastPurchaseAt',
    operator: 'older_than_days',
    value: 90,
  },
};
const model = (configuration = baseline, rows = customers) =>
  buildTableModel(rows, configuration, page, { evaluationTime });

describe('framework-independent contracts', () => {
  it('accepts the registered host and rejects unknown schema keys', () => {
    expect(validateRegistry(registry).success).toBe(true);
    expect(validateRegistry({ ...registry, render: 'ReactComponent' }).success).toBe(false);
    expect(validateConfiguration({ ...baseline, javascript: 'alert(1)' }, page).success).toBe(
      false,
    );
  });
  it('rejects duplicate field, page, capability and saved-view identifiers', () => {
    const duplicate = structuredClone(registry);
    duplicate.pages[0].fields.push(duplicate.pages[0].fields[0]);
    expect(validateRegistry(duplicate).success).toBe(false);
    expect(validateRegistry({ ...registry, pages: [page, page] }).success).toBe(false);
    const capDuplicate = structuredClone(registry);
    capDuplicate.pages[0].operations.push(page.operations[0]);
    expect(validateRegistry(capDuplicate).success).toBe(false);
    const view = {
      id: 'v',
      name: 'View',
      configuration: { columns: baseline.columns, filters: [], sort: [] },
    };
    expect(validateConfiguration({ ...baseline, savedViews: [view, view] }, page).success).toBe(
      false,
    );
  });
  it('rejects unregistered references, bad field types and wrong pages', () => {
    expect(validateOperations([{ ...inactivity, capabilityId: 'invented' }], page).success).toBe(
      false,
    );
    expect(
      validateOperations(
        [{ ...inactivity, filter: { ...inactivity.filter, fieldId: 'secret' } }],
        page,
      ).success,
    ).toBe(false);
    expect(
      validateOperations([{ ...inactivity, filter: { ...inactivity.filter, value: '90' } }], page)
        .success,
    ).toBe(false);
    expect(validateConfiguration({ ...baseline, pageId: 'other' }, page).success).toBe(false);
    expect(validateOperations([{ ...inactivity, execute: 'unsafe' }], page).success).toBe(false);
  });
  it('enforces capability-specific allowlists and operation kinds', () => {
    const restricted = structuredClone(page);
    restricted.operations[0].allowedFieldIds = ['name'];
    expect(validateOperations([inactivity], restricted).success).toBe(false);
    expect(
      validateOperations([{ ...inactivity, capabilityId: 'customer-order' }], page).success,
    ).toBe(false);
  });
  it.each([0, -1, 0.5, 3651])('rejects invalid relative day count %s', (value) => {
    expect(
      validateOperations([{ ...inactivity, filter: { ...inactivity.filter, value } }], page)
        .success,
    ).toBe(false);
  });
  it('enforces limits and rejects operators incompatible with field types', () => {
    expect(validateOperations(Array(33).fill(inactivity), page).success).toBe(false);
    const badRegistry = structuredClone(registry);
    badRegistry.pages[0].fields[0].filterOperators = ['older_than_days'];
    expect(validateRegistry(badRegistry).success).toBe(false);
  });
});

describe('deterministic runtime transformations', () => {
  it('filters relative dates without mutating baseline, operations or rows', () => {
    const before = canonicalize({ baseline, customers, inactivity });
    const config = applyOperations(baseline, [inactivity], page);
    expect(model(config).rows.map((r) => r.id)).toEqual(['c1', 'c3', 'c5', 'c7']);
    expect(canonicalize({ baseline, customers, inactivity })).toBe(before);
    expect(model().rows).toHaveLength(8);
  });
  it('uses strict cutoff and excludes null purchases', () => {
    const config = applyOperations(baseline, [inactivity], page);
    const cutoff = new Date(Date.parse(evaluationTime) - 90 * 86400000).toISOString();
    expect(model(config, [{ ...customers[0], lastPurchaseAt: cutoff }]).rows).toHaveLength(0);
    expect(model(config, [{ ...customers[0], lastPurchaseAt: null }]).rows).toHaveLength(0);
  });
  it('supports explicit null filters without a value', () => {
    const config = applyOperations(
      baseline,
      [
        {
          ...inactivity,
          filter: {
            id: 'never',
            label: 'Never purchased',
            fieldId: 'lastPurchaseAt',
            operator: 'is_null',
          },
        },
      ],
      page,
    );
    expect(model(config).rows.map((r) => r.id)).toEqual(['c4']);
    expect(
      validateOperations(
        [{ ...inactivity, filter: { ...inactivity.filter, operator: 'is_null' } }],
        page,
      ).success,
    ).toBe(false);
  });
  it('rejects missing adapter fields and malformed dates instead of silently filtering', () => {
    const config = applyOperations(baseline, [inactivity], page);
    expect(() => model(config, [{ ...customers[0], lastPurchaseAt: undefined }])).toThrow(
      'Missing or invalid',
    );
    expect(() =>
      model(config, [{ ...customers[0], lastPurchaseAt: '2026-02-30T00:00:00.000Z' }]),
    ).toThrow('Missing or invalid');
    expect(() =>
      buildTableModel(customers, baseline, page, { evaluationTime: 'bad date' }),
    ).toThrow('Evaluation time');
  });
  it('applies visibility and order while requiring a complete permutation', () => {
    const config = applyOperations(
      baseline,
      [
        {
          capabilityId: 'customer-visibility',
          kind: 'set_column_visibility',
          fieldId: 'revenue',
          visible: false,
        },
        {
          capabilityId: 'customer-order',
          kind: 'reorder_columns',
          fieldIds: ['company', 'name', 'region', 'revenue', 'lastPurchaseAt'],
        },
      ],
      page,
    );
    expect(model(config).columns.map((c) => c.id)).toEqual([
      'company',
      'name',
      'region',
      'lastPurchaseAt',
    ]);
    expect(() =>
      applyOperations(
        baseline,
        [{ capabilityId: 'customer-order', kind: 'reorder_columns', fieldIds: ['name'] }],
        page,
      ),
    ).toThrow('every configured column');
    expect(() =>
      applyOperations(
        baseline,
        [
          {
            capabilityId: 'customer-order',
            kind: 'reorder_columns',
            fieldIds: ['name', 'name', 'region', 'revenue', 'lastPurchaseAt'],
          },
        ],
        page,
      ),
    ).toThrow('every configured column');
  });
  it('prevents hiding every column and duplicate filter IDs', () => {
    expect(() =>
      applyOperations(
        baseline,
        baseline.columns.map((c) => ({
          capabilityId: 'customer-visibility',
          kind: 'set_column_visibility',
          fieldId: c.fieldId,
          visible: false,
        })),
        page,
      ),
    ).toThrow('At least one column');
    expect(() => applyOperations(baseline, [inactivity, inactivity], page)).toThrow('Duplicate');
  });
  it('creates validated saved snapshots with independent selection', () => {
    const filtered = applyOperations(baseline, [inactivity], page);
    const config = applyOperations(
      baseline,
      [
        {
          capabilityId: 'customer-view',
          kind: 'create_saved_view',
          view: {
            id: 'inactive',
            name: 'Follow up',
            configuration: { columns: filtered.columns, filters: filtered.filters, sort: [] },
          },
        },
      ],
      page,
    );
    expect(model(config).rows).toHaveLength(8);
    expect(model(selectSavedView(config, 'inactive')).rows).toHaveLength(4);
    expect(config.filters).toHaveLength(0);
    expect(() => selectSavedView(config, 'missing')).toThrow('does not exist');
    expect(validateConfiguration({ ...config, defaultViewId: 'missing' }, page).success).toBe(
      false,
    );
  });
  it('combines predicates with AND and uses case-insensitive contains', () => {
    const config = applyOperations(
      baseline,
      [
        inactivity,
        {
          capabilityId: 'customer-filter',
          kind: 'add_filter',
          filter: {
            id: 'name',
            label: 'Name',
            fieldId: 'name',
            operator: 'contains',
            value: 'ADITI',
          },
        },
      ],
      page,
    );
    expect(model(config).rows.map((r) => r.id)).toEqual(['c1']);
  });
  it('sorts stably with null dates last in either direction', () => {
    const ascending = {
      ...baseline,
      sort: [{ fieldId: 'lastPurchaseAt', direction: 'asc' as const }],
    };
    const descending = {
      ...baseline,
      sort: [{ fieldId: 'lastPurchaseAt', direction: 'desc' as const }],
    };
    expect(model(ascending).rows.at(-1)?.id).toBe('c4');
    expect(model(descending).rows.at(-1)?.id).toBe('c4');
    const tied = customers.map((r) => ({ ...r, revenue: 1 }));
    expect(
      model({ ...baseline, sort: [{ fieldId: 'revenue', direction: 'asc' }] }, tied).rows.map(
        (r) => r.id,
      ),
    ).toEqual(customers.map((r) => r.id));
  });
  it('canonicalizes key order while preserving array order and refusing non-JSON values', () => {
    expect(canonicalize({ b: 2, a: [1, 2] })).toBe(canonicalize({ a: [1, 2], b: 2 }));
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
    expect(() => canonicalize({ secret: undefined })).toThrow('finite JSON');
    expect(() => canonicalize(NaN)).toThrow('finite JSON');
  });
});
