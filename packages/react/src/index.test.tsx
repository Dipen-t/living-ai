import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyOperations } from '@evolvekit/core';
import { EvolvePreview, EvolveProvider, EvolvableTable } from './index';
import {
  baseline,
  customers,
  evaluationTime,
  page,
  registry,
} from '../../../apps/demo-erp/src/fixtures';

const proposed = applyOperations(
  baseline,
  [
    {
      capabilityId: 'customer-filter',
      kind: 'add_filter',
      filter: {
        id: 'inactive',
        label: 'Inactive',
        fieldId: 'lastPurchaseAt',
        operator: 'older_than_days',
        value: 90,
      },
    },
  ],
  page,
);
const table = (
  <EvolvableTable pageId="customers" rows={customers} rowKey="id" caption="Customers" />
);
const provider = (configuration: typeof baseline, children: React.ReactNode) => (
  <EvolveProvider
    registry={registry}
    configurations={{ customers: configuration }}
    evaluationTime={evaluationTime}
  >
    {children}
  </EvolveProvider>
);
const tables = (html: string) => html.match(/<table>[\s\S]*?<\/table>/g);

describe('shared renderer', () => {
  it('adds host-owned tool actions only to visible rows and leaves normal tables unchanged', () => {
    const html = renderToStaticMarkup(
      provider(
        proposed,
        <EvolvableTable
          pageId="customers"
          rows={customers}
          rowKey="id"
          caption="Customers"
          rowAction={{ label: 'Check discount', onSelect: () => {} }}
        />,
      ),
    );
    const count = (html.match(/>Check discount<\/button>/g) ?? []).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(customers.length);
    expect(count).toBe((html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr/g) ?? []).length);
    expect(renderToStaticMarkup(provider(proposed, table))).not.toContain('Check discount');
  });
  it('renders renamed columns identically in preview and production', () => {
    const changed = applyOperations(
      baseline,
      [
        {
          capabilityId: 'customers-column-labels',
          kind: 'set_column_label',
          fieldId: 'revenue',
          label: 'Amount',
        },
      ],
      page,
    );
    const active = renderToStaticMarkup(provider(changed, table));
    const preview = renderToStaticMarkup(
      provider(
        baseline,
        <EvolvePreview pageId="customers" configuration={changed}>
          {table}
        </EvolvePreview>,
      ),
    );
    expect(tables(active)).toEqual(tables(preview));
    expect(active).toContain('Amount');
    expect(active).not.toContain('Revenue');
  });
  it('renders the moved button identically in preview and production and binds only its registered handler', () => {
    const changed = applyOperations(
      baseline,
      [
        {
          kind: 'set_action',
          capabilityId: 'customer-action-layout',
          actionId: 'add-customer',
          label: 'New Customer',
          position: 'above_table',
        },
      ],
      page,
    );
    const actionTable = (
      <EvolvableTable
        pageId="customers"
        rows={customers}
        rowKey="id"
        caption="Customers"
        actionHandlers={{ 'open-customer-form': () => {} }}
      />
    );
    const active = renderToStaticMarkup(provider(changed, actionTable));
    const preview = renderToStaticMarkup(
      provider(
        baseline,
        <EvolvePreview pageId="customers" configuration={changed}>
          {actionTable}
        </EvolvePreview>,
      ),
    );
    const buttonSlot = (html: string) =>
      html.match(/<div class="evolve-actions evolve-actions-above_table"[\s\S]*?<\/div>/)?.[0];
    expect(buttonSlot(active)).toBe(buttonSlot(preview));
    expect(buttonSlot(active)).toContain('New Customer');
    expect(buttonSlot(active)).not.toContain('disabled');
    expect(active.indexOf('New Customer')).toBeLessThan(active.indexOf('<table>'));
    expect(active).not.toContain('data-action-position="page_header"');
    const below = renderToStaticMarkup(
      provider(
        applyOperations(
          changed,
          [
            {
              kind: 'set_action',
              capabilityId: 'customer-action-layout',
              actionId: 'add-customer',
              position: 'below_table',
            },
          ],
          page,
        ),
        actionTable,
      ),
    );
    expect(below.indexOf('New Customer')).toBeGreaterThan(below.indexOf('</table>'));
  });
  it.each([
    ['plain', '184000'],
    ['indian', '1,84,000'],
    ['international', '184,000'],
  ] as const)(
    'uses saved %s formatting identically in preview and production',
    (format, expected) => {
      const formatted = applyOperations(
        baseline,
        [
          {
            capabilityId: 'customer-number-format',
            kind: 'set_number_format',
            fieldId: 'revenue',
            format,
          },
        ],
        page,
      );
      const production = renderToStaticMarkup(provider(formatted, table));
      const preview = renderToStaticMarkup(
        provider(
          baseline,
          <EvolvePreview pageId="customers" configuration={formatted}>
            {table}
          </EvolvePreview>,
        ),
      );
      expect(tables(preview)).toEqual(tables(production));
      expect(production).toContain(`<td>${expected}</td>`);
    },
  );
  it('groups numeric amounts with Indian commas in both preview and production without changing rows', () => {
    const original = customers[0].revenue;
    const production = renderToStaticMarkup(provider(baseline, table));
    const preview = renderToStaticMarkup(
      provider(
        baseline,
        <EvolvePreview pageId="customers" configuration={baseline}>
          {table}
        </EvolvePreview>,
      ),
    );
    expect(production).toContain('1,84,000');
    expect(production).toContain('92,500');
    expect(tables(preview)).toEqual(tables(production));
    expect(customers[0].revenue).toBe(original);
  });
  it('renders identical tables for preview and production with identical inputs', () => {
    const production = renderToStaticMarkup(provider(proposed, table));
    const preview = renderToStaticMarkup(
      provider(
        baseline,
        <EvolvePreview pageId="customers" configuration={proposed}>
          {table}
        </EvolvePreview>,
      ),
    );
    expect(tables(preview)).toEqual(tables(production));
    expect(preview).toContain('4 of 8 rows');
  });
  it('keeps the preview override isolated from sibling tables', () => {
    const html = renderToStaticMarkup(
      provider(
        baseline,
        <>
          {table}
          <EvolvePreview pageId="customers" configuration={proposed}>
            {table}
          </EvolvePreview>
          {table}
        </>,
      ),
    );
    const result = tables(html)!;
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(result[2]);
    expect(result[1]).not.toEqual(result[0]);
    expect(result[0]).toContain('Kabir Menon');
    expect(result[1]).not.toContain('Kabir Menon');
  });
  it('rejects an invalid preview while leaving the baseline available', () => {
    const html = renderToStaticMarkup(
      provider(
        baseline,
        <>
          {table}
          <EvolvePreview pageId="customers" configuration={{ ...baseline, pageId: 'invalid' }}>
            {table}
          </EvolvePreview>
        </>,
      ),
    );
    expect(html).toContain('role="alert"');
    expect(tables(html)).toHaveLength(1);
    expect(html).toContain('8 of 8 rows');
  });
  it('reports adapter errors through accessible status', () => {
    const html = renderToStaticMarkup(
      provider(
        baseline,
        <EvolvableTable
          pageId="customers"
          rows={[{ id: 'broken' }]}
          rowKey="id"
          caption="Customers"
        />,
      ),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Missing or invalid value');
  });
  it('loads a saved default view through the same runtime', () => {
    const config = {
      ...baseline,
      savedViews: [
        {
          id: 'inactive',
          name: 'Follow up',
          configuration: { columns: proposed.columns, filters: proposed.filters, sort: [] },
        },
      ],
      defaultViewId: 'inactive',
    };
    const html = renderToStaticMarkup(provider(config, table));
    expect(html).toContain('4 of 8 rows');
    expect(html).toContain('Follow up');
  });
});
