import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  buildTableModel,
  ConfigurationError,
  selectSavedView,
  validateConfiguration,
  validateRegistry,
  resolveActions,
  type ActionPosition,
  type CapabilityRegistry,
  type PageCapability,
  type TableConfiguration,
} from '@evolvekit/core';

interface RuntimeContext {
  registry: CapabilityRegistry;
  configurations: Readonly<Record<string, TableConfiguration>>;
  evaluationTime: string;
}
const Runtime = createContext<RuntimeContext | null>(null);
const Preview = createContext<{ pageId: string; configuration: TableConfiguration } | null>(null);
export interface EvolveProviderProps extends RuntimeContext {
  children: ReactNode;
}
export function EvolveProvider({
  registry,
  configurations,
  evaluationTime,
  children,
}: EvolveProviderProps) {
  const value = useMemo(() => {
    const checked = validateRegistry(registry);
    if (!checked.success) throw new ConfigurationError(checked.errors);
    for (const [pageId, config] of Object.entries(configurations)) {
      const page = checked.data.pages.find((p) => p.pageId === pageId);
      if (!page) throw new Error(`Page ${pageId} is not registered.`);
      const validated = validateConfiguration(config, page);
      if (!validated.success) throw new ConfigurationError(validated.errors);
    }
    return { registry: checked.data, configurations, evaluationTime };
  }, [registry, configurations, evaluationTime]);
  return <Runtime.Provider value={value}>{children}</Runtime.Provider>;
}
function useRuntime() {
  const runtime = useContext(Runtime);
  if (!runtime) throw new Error('EvolveKit components require an EvolveProvider.');
  return runtime;
}
export function useActiveConfiguration(pageId: string): {
  configuration: TableConfiguration;
  page: PageCapability;
  preview: boolean;
  evaluationTime: string;
} {
  const runtime = useRuntime(),
    preview = useContext(Preview);
  const page = runtime.registry.pages.find((p) => p.pageId === pageId);
  if (!page) throw new Error(`Page ${pageId} is not registered.`);
  const isPreview = preview?.pageId === pageId;
  return {
    page,
    configuration: isPreview
      ? preview.configuration
      : (runtime.configurations[pageId] ?? page.baseline),
    preview: isPreview,
    evaluationTime: runtime.evaluationTime,
  };
}
export function EvolvePreview({
  pageId,
  configuration,
  children,
}: {
  pageId: string;
  configuration: TableConfiguration;
  children: ReactNode;
}) {
  const { page } = useActiveConfiguration(pageId);
  const validated = validateConfiguration(configuration, page);
  if (!validated.success)
    return (
      <div role="alert" className="evolve-error">
        Preview unavailable: {validated.errors.map((e) => e.message).join(' ')}
      </div>
    );
  return (
    <Preview.Provider value={{ pageId, configuration: validated.data }}>
      <section aria-label="Proposed configuration preview" className="evolve-preview">
        {children}
      </section>
    </Preview.Provider>
  );
}
export interface EvolvableTableProps {
  pageId: string;
  rows: readonly Record<string, unknown>[];
  caption: string;
  rowKey: string;
  itemLabel?: string;
  searchPlaceholder?: string;
  actionHandlers?: Readonly<Record<string, () => void>>;
  rowAction?: { label: string; onSelect: (row: Record<string, unknown>) => void };
}
export function EvolvableTable(props: EvolvableTableProps) {
  const { configuration, page, evaluationTime } = useActiveConfiguration(props.pageId);
  // Remount local view selection when the immutable configuration changes.
  return (
    <TableRuntime
      key={JSON.stringify(configuration)}
      {...props}
      configuration={configuration}
      page={page}
      evaluationTime={evaluationTime}
    />
  );
}
const numberFormatters = {
  indian: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 20 }),
  international: new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }),
};
function TableRuntime({
  actionHandlers,
  rowAction,
  rows,
  caption,
  rowKey,
  itemLabel = 'rows',
  searchPlaceholder = 'Search rows…',
  configuration,
  page,
  evaluationTime,
}: EvolvableTableProps & {
  configuration: TableConfiguration;
  page: PageCapability;
  evaluationTime: string;
}) {
  const [viewId, setViewId] = useState<string | null>(configuration.defaultViewId);
  const [search, setSearch] = useState('');
  const selected = selectSavedView(configuration, viewId);
  const actions = resolveActions(configuration, page);
  const actionSlot = (position: ActionPosition) =>
    actions.some((action) => action.position === position) ? (
      <div className={`evolve-actions evolve-actions-${position}`} data-action-position={position}>
        {actions
          .filter((action) => action.position === position)
          .map((action) => {
            const definition = page.actions!.find((value) => value.id === action.actionId)!;
            const handler = actionHandlers?.[definition.handlerId];
            return (
              <button
                type="button"
                key={action.actionId}
                data-action-id={action.actionId}
                disabled={!handler}
                onClick={handler}
              >
                {action.label}
              </button>
            );
          })}
      </div>
    ) : null;
  const numberText = (fieldId: string, value: number) => {
    const format =
      selected.columns.find((column) => column.fieldId === fieldId)?.numberFormat ?? 'indian';
    return format === 'plain' ? String(value) : numberFormatters[format].format(value);
  };
  let model;
  try {
    model = buildTableModel(rows, selected, page, { evaluationTime });
  } catch (error) {
    return (
      <div role="alert" className="evolve-error">
        Table unavailable: {error instanceof Error ? error.message : 'Invalid data.'}
      </div>
    );
  }
  const visibleRows = search
    ? model.rows.filter((row) =>
        model.columns.some((c) => {
          const raw = String(row[c.id] ?? '').toLowerCase();
          const formatted =
            c.type === 'number' && typeof row[c.id] === 'number'
              ? numberText(c.id, row[c.id] as number)
              : raw;
          return raw.includes(search.toLowerCase()) || formatted.includes(search.toLowerCase());
        }),
      )
    : model.rows;
  return (
    <div className="evolve-table-container">
      {actionSlot('page_header')}
      <div className="table-tools">
        <label className="search-label">
          Search
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {configuration.savedViews.length > 0 && (
          <label>
            Saved view
            <select value={viewId ?? ''} onChange={(e) => setViewId(e.target.value || null)}>
              <option value="">Default table</option>
              {configuration.savedViews.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="row-count" role="status">
          {visibleRows.length} of {model.totalRows} {itemLabel}
        </span>
      </div>
      {selected.filters.length > 0 && (
        <ul className="filter-list" aria-label="Active filters">
          {selected.filters.map((f) => (
            <li key={f.id}>{f.label}</li>
          ))}
        </ul>
      )}
      {actionSlot('above_table')}
      <div className="table-scroll" tabIndex={0} aria-label={`${caption} scroll area`}>
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {model.columns.map((c) => (
                <th key={c.id} scope="col">
                  {c.label}
                </th>
              ))}
              {rowAction && <th scope="col">Tool</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr key={String(row[rowKey] ?? i)}>
                {model.columns.map((c) => (
                  <td key={c.id}>
                    {row[c.id] === null ? (
                      <span className="null-value">Not set</span>
                    ) : c.type === 'date' ? (
                      new Date(row[c.id] as string).toISOString().slice(0, 10)
                    ) : c.type === 'number' ? (
                      numberText(c.id, row[c.id] as number)
                    ) : typeof row[c.id] === 'boolean' ? (
                      row[c.id] ? (
                        'Yes'
                      ) : (
                        'No'
                      )
                    ) : (
                      String(row[c.id])
                    )}
                  </td>
                ))}
                {rowAction && (
                  <td>
                    <button type="button" onClick={() => rowAction.onSelect(row)}>
                      {rowAction.label}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {visibleRows.length === 0 && (
          <p className="empty-state">No matching {itemLabel}. Adjust the proposal or search.</p>
        )}
      </div>
      {actionSlot('below_table')}
    </div>
  );
}
