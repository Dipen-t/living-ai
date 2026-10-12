import type { CapabilityRegistry, TableConfiguration } from '@evolvekit/core';
export const evaluationTime = '2026-10-12T00:00:00.000Z';
export const baseline: TableConfiguration = {
  schemaVersion: 1,
  pageId: 'customers',
  columns: ['name', 'company', 'region', 'lastPurchaseAt', 'revenue'].map((fieldId) => ({
    fieldId,
    visible: true,
  })),
  filters: [],
  sort: [],
  savedViews: [],
  defaultViewId: null,
};
const fieldIds = baseline.columns.map((c) => c.fieldId);
export const legacyRegistry: CapabilityRegistry = {
  schemaVersion: 1,
  applicationId: 'demo-erp',
  version: 'v1',
  pages: [
    {
      pageId: 'customers',
      routeKey: '/customers',
      component: { id: 'customer-table', contractVersion: 1 },
      dataAdapter: {
        productionId: 'synthetic-customers',
        previewId: 'synthetic-customers',
        contractVersion: 1,
      },
      fields: [
        {
          id: 'name',
          label: 'Customer',
          type: 'string',
          nullable: false,
          filterOperators: ['eq', 'contains'],
          canDisplay: true,
          canSort: true,
        },
        {
          id: 'company',
          label: 'Company',
          type: 'string',
          nullable: false,
          filterOperators: ['eq', 'contains'],
          canDisplay: true,
          canSort: true,
        },
        {
          id: 'region',
          label: 'Region',
          type: 'string',
          nullable: false,
          filterOperators: ['eq'],
          canDisplay: true,
          canSort: true,
        },
        {
          id: 'lastPurchaseAt',
          label: 'Last purchase',
          type: 'date',
          nullable: true,
          filterOperators: ['older_than_days', 'is_null', 'is_not_null', 'lt'],
          canDisplay: true,
          canSort: true,
        },
        {
          id: 'revenue',
          label: 'Revenue (₹)',
          type: 'number',
          nullable: false,
          filterOperators: ['gte', 'lte'],
          canDisplay: true,
          canSort: true,
        },
      ],
      operations: [
        { id: 'customer-filter', kind: 'add_filter', allowedFieldIds: fieldIds },
        { id: 'customer-visibility', kind: 'set_column_visibility', allowedFieldIds: fieldIds },
        { id: 'customer-order', kind: 'reorder_columns', allowedFieldIds: fieldIds },
        { id: 'customer-view', kind: 'create_saved_view', allowedFieldIds: fieldIds },
      ],
      baseline,
    },
  ],
};
export const numberFormatRegistry: CapabilityRegistry = {
  ...structuredClone(legacyRegistry),
  version: 'v2-number-format',
  pages: legacyRegistry.pages.map((page) => ({
    ...structuredClone(page),
    operations: [
      ...page.operations,
      { id: 'customer-number-format', kind: 'set_number_format', allowedFieldIds: ['revenue'] },
    ],
  })),
};
export const ordersBaseline: TableConfiguration = {
  schemaVersion: 1,
  pageId: 'orders',
  columns: ['orderNumber', 'customer', 'status', 'orderedAt', 'amount'].map((fieldId) => ({
    fieldId,
    visible: true,
  })),
  filters: [],
  sort: [],
  savedViews: [],
  defaultViewId: null,
};
export const ordersRegistry: CapabilityRegistry = {
  ...structuredClone(numberFormatRegistry),
  version: 'v3-orders',
  pages: [
    ...structuredClone(numberFormatRegistry.pages),
    {
      pageId: 'orders',
      routeKey: '/orders',
      component: { id: 'orders-table', contractVersion: 1 },
      dataAdapter: {
        productionId: 'synthetic-orders',
        previewId: 'synthetic-orders',
        contractVersion: 1,
      },
      fields: [
        {
          id: 'orderNumber',
          label: 'Order',
          type: 'string',
          nullable: false,
          filterOperators: ['eq', 'contains'],
          canDisplay: true,
          canSort: true,
        },
        {
          id: 'customer',
          label: 'Customer',
          type: 'string',
          nullable: false,
          filterOperators: ['eq', 'contains'],
          canDisplay: true,
          canSort: true,
        },
        {
          id: 'status',
          label: 'Status',
          type: 'string',
          nullable: false,
          filterOperators: ['eq'],
          canDisplay: true,
          canSort: true,
        },
        {
          id: 'orderedAt',
          label: 'Order date',
          type: 'date',
          nullable: false,
          filterOperators: ['older_than_days', 'lt'],
          canDisplay: true,
          canSort: true,
        },
        {
          id: 'amount',
          label: 'Amount (₹)',
          type: 'number',
          nullable: false,
          filterOperators: ['gte', 'lte'],
          canDisplay: true,
          canSort: true,
        },
      ],
      operations: [
        {
          id: 'order-filter',
          kind: 'add_filter',
          allowedFieldIds: ordersBaseline.columns.map((c) => c.fieldId),
        },
        {
          id: 'order-visibility',
          kind: 'set_column_visibility',
          allowedFieldIds: ordersBaseline.columns.map((c) => c.fieldId),
        },
        {
          id: 'order-columns',
          kind: 'reorder_columns',
          allowedFieldIds: ordersBaseline.columns.map((c) => c.fieldId),
        },
        {
          id: 'order-view',
          kind: 'create_saved_view',
          allowedFieldIds: ordersBaseline.columns.map((c) => c.fieldId),
        },
        { id: 'order-number-format', kind: 'set_number_format', allowedFieldIds: ['amount'] },
      ],
      baseline: ordersBaseline,
    },
  ],
};
export const actionRegistry: CapabilityRegistry = {
  ...structuredClone(ordersRegistry),
  version: 'v4-page-actions',
  pages: ordersRegistry.pages.map((page) =>
    page.pageId !== 'customers'
      ? structuredClone(page)
      : {
          ...structuredClone(page),
          actions: [
            {
              id: 'add-customer',
              label: 'Add Customer',
              handlerId: 'open-customer-form',
              defaultPosition: 'page_header',
              allowedPositions: ['page_header', 'above_table', 'below_table'],
            },
          ],
          operations: [
            ...page.operations,
            {
              id: 'customer-action-layout',
              kind: 'set_action',
              allowedFieldIds: [],
              allowedActionIds: ['add-customer'],
            },
          ],
        },
  ),
};
export const followUpsRegistry: CapabilityRegistry = {
  ...structuredClone(actionRegistry),
  version: 'v5-customer-followups',
  pages: actionRegistry.pages.map((page) =>
    page.pageId === 'customers'
      ? {
          ...structuredClone(page),
          features: [{ id: 'customer-followups', contractVersion: 1 }],
          operations: [
            ...page.operations,
            {
              id: 'customer-followups-workflow',
              kind: 'set_feature',
              allowedFieldIds: [],
              allowedFeatureIds: ['customer-followups'],
            },
          ],
        }
      : structuredClone(page),
  ),
};
export const registry: CapabilityRegistry = {
  ...structuredClone(followUpsRegistry),
  version: 'v6-column-labels',
  pages: followUpsRegistry.pages.map((page) => ({
    ...structuredClone(page),
    operations: [
      ...page.operations,
      {
        id: `${page.pageId}-column-labels`,
        kind: 'set_column_label',
        allowedFieldIds: page.fields.filter((field) => field.canDisplay).map((field) => field.id),
      },
    ],
  })),
};
export const page = registry.pages[0];
export const orders: Record<string, unknown>[] = [
  {
    id: 'o1',
    orderNumber: 'ORD-1001',
    customer: 'Northline Textiles',
    status: 'Pending',
    orderedAt: '2026-05-02T00:00:00.000Z',
    amount: 184000,
  },
  {
    id: 'o2',
    orderNumber: 'ORD-1002',
    customer: 'Harbor Supply',
    status: 'Shipped',
    orderedAt: '2026-10-01T00:00:00.000Z',
    amount: 92500,
  },
  {
    id: 'o3',
    orderNumber: 'ORD-1003',
    customer: 'Fieldwork Studio',
    status: 'Pending',
    orderedAt: '2026-06-14T00:00:00.000Z',
    amount: 67000,
  },
  {
    id: 'o4',
    orderNumber: 'ORD-1004',
    customer: 'Meridian Foods',
    status: 'Delivered',
    orderedAt: '2026-07-01T00:00:00.000Z',
    amount: 246000,
  },
  {
    id: 'o5',
    orderNumber: 'ORD-1005',
    customer: 'Cedar Works',
    status: 'Shipped',
    orderedAt: '2026-09-15T00:00:00.000Z',
    amount: 135000,
  },
  {
    id: 'o6',
    orderNumber: 'ORD-1006',
    customer: 'Orbit Packaging',
    status: 'Pending',
    orderedAt: '2026-04-21T00:00:00.000Z',
    amount: 112000,
  },
];
export const customers: Record<string, unknown>[] = [
  {
    id: 'c1',
    name: 'Aditi Shah',
    company: 'Northline Textiles',
    region: 'West',
    lastPurchaseAt: '2026-05-02T00:00:00.000Z',
    revenue: 184000,
  },
  {
    id: 'c2',
    name: 'Kabir Menon',
    company: 'Harbor Supply',
    region: 'South',
    lastPurchaseAt: '2026-10-01T00:00:00.000Z',
    revenue: 92500,
  },
  {
    id: 'c3',
    name: 'Meera Joshi',
    company: 'Fieldwork Studio',
    region: 'West',
    lastPurchaseAt: '2026-06-14T00:00:00.000Z',
    revenue: 67000,
  },
  {
    id: 'c4',
    name: 'Rohan Das',
    company: 'Eastern Paper Co.',
    region: 'East',
    lastPurchaseAt: null,
    revenue: 0,
  },
  {
    id: 'c5',
    name: 'Zoya Khan',
    company: 'Meridian Foods',
    region: 'North',
    lastPurchaseAt: '2026-07-01T00:00:00.000Z',
    revenue: 246000,
  },
  {
    id: 'c6',
    name: 'Arjun Rao',
    company: 'Cedar Works',
    region: 'South',
    lastPurchaseAt: '2026-09-15T00:00:00.000Z',
    revenue: 135000,
  },
  {
    id: 'c7',
    name: 'Nisha Patel',
    company: 'Orbit Packaging',
    region: 'West',
    lastPurchaseAt: '2026-04-21T00:00:00.000Z',
    revenue: 112000,
  },
  {
    id: 'c8',
    name: 'Dev Malik',
    company: 'Anchor Logistics',
    region: 'North',
    lastPurchaseAt: '2026-08-28T00:00:00.000Z',
    revenue: 305000,
  },
];
