import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoSession, ToolBinding, ToolRecord } from '@evolvekit/core';
import type { EvolvableTableProps } from '@evolvekit/react';
import { request } from './api';
import { ToolResult, toolFieldLabel, toolValueText } from './ToolView';
import './order-tool.css';

type ActiveTool = {
  id: string;
  summary: string;
  state: string;
  cases: { input: ToolRecord }[];
  binding: ToolBinding | null;
  source: { featureId: string };
  generation: number;
};
export function OrderTool({
  session,
  children,
}: {
  session: DemoSession | null;
  children: (action: EvolvableTableProps['rowAction']) => ReactNode;
}) {
  const [tool, setTool] = useState<ActiveTool | null>(null);
  const [order, setOrder] = useState<{ id: string; label: string } | null>(null);
  const [input, setInput] = useState<Record<string, string>>({}),
    [result, setResult] = useState<ToolRecord | null>(null),
    [preview, setPreview] = useState('');
  const [effectiveInput, setEffectiveInput] = useState<ToolRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const epoch = useRef(0),
    heading = useRef<HTMLHeadingElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let current = true;
    if (!session?.permissions.includes('code:data') || !session.permissions.includes('code:read')) {
      setTool(null);
      return;
    }
    const refresh = async () => {
      try {
        const response = await request<{ tool: ActiveTool | null }>(
          '/v1/code-tools/active?sourceId=orders',
        );
        if (current) setTool(response.tool);
      } catch {
        if (current) setTool(null);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [session?.principal.subjectId]);
  useEffect(() => {
    epoch.current++;
    setOrder(null);
    setResult(null);
    setPreview('');
    setError('');
    setEffectiveInput(null);
  }, [tool?.id, tool?.generation, session?.principal.subjectId]);
  useEffect(() => {
    if (order) heading.current?.focus();
  }, [order?.id]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  const select = (row: Record<string, unknown>) => {
    if (!tool || typeof row.id !== 'string') return;
    epoch.current++;
    returnFocus.current = document.activeElement as HTMLElement;
    setOrder({ id: row.id, label: String(row.orderNumber ?? row.id) });
    setInput(
      Object.fromEntries(
        Object.entries(tool.cases[0].input)
          .filter(([key]) => !tool.binding!.mappings.some((mapping) => mapping.inputId === key))
          .map(([key, value]) => [key, String(value)]),
      ),
    );
    setResult(null);
    setPreview('');
    setError('');
    setEffectiveInput(null);
  };
  const change = (key: string, value: string) => {
    epoch.current++;
    setInput((previous) => ({ ...previous, [key]: value }));
    setResult(null);
    setPreview('');
    setError('');
  };
  return (
    <>
      {children(
        tool
          ? {
              label:
                tool.source.featureId === 'discount-eligibility-example'
                  ? 'Check discount'
                  : 'Use tool',
              onSelect: select,
            }
          : undefined,
      )}
      {tool && order && (
        <section className="order-tool" aria-labelledby="order-tool-heading">
          <header>
            <h3 id="order-tool-heading" tabIndex={-1} ref={heading}>
              Check {order.label}
            </h3>
            <button
              type="button"
              onClick={() => {
                epoch.current++;
                setOrder(null);
                returnFocus.current?.focus();
              }}
            >
              Close tool
            </button>
          </header>
          <p>{tool.summary}</p>
          <p>
            Order values come from the workspace. Fill in the remaining details. Running this tool
            does not change the order.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const current = epoch.current;
              setBusy(true);
              setError('');
              setResult(null);
              setPreview('');
              try {
                const response = await request<{
                  proposalId: string;
                  generation: number;
                  result: ToolRecord;
                  preview: string;
                  effectiveInput: ToolRecord;
                }>('/v1/code-evaluate', {
                  proposalId: null,
                  recordId: order.id,
                  expectedActive: { proposalId: tool.id, generation: tool.generation },
                  input: Object.fromEntries(
                    Object.entries(input).map(([key, value]) => [
                      key,
                      typeof tool.cases[0].input[key] === 'number'
                        ? Number(value)
                        : typeof tool.cases[0].input[key] === 'boolean'
                          ? value === 'true'
                          : value,
                    ]),
                  ),
                });
                if (current !== epoch.current) return;
                if (response.proposalId !== tool.id || response.generation !== tool.generation)
                  throw new Error('The active tool changed. Reopen it and try again.');
                setResult(response.result);
                setPreview(response.preview);
                setEffectiveInput(response.effectiveInput);
              } catch (error) {
                if (current === epoch.current)
                  setError(
                    error instanceof Error ? error.message : 'The tool could not run. Try again.',
                  );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="order-tool-inputs">
              {Object.entries(input).map(([key, value]) => (
                <label key={key}>
                  {toolFieldLabel(key)}
                  {typeof tool.cases[0].input[key] === 'boolean' ? (
                    <select
                      value={value}
                      disabled={busy}
                      onChange={(event) => change(key, event.target.value)}
                    >
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  ) : (
                    <input
                      type={typeof tool.cases[0].input[key] === 'number' ? 'number' : 'text'}
                      step="any"
                      maxLength={500}
                      value={value}
                      required={typeof tool.cases[0].input[key] === 'number'}
                      disabled={busy}
                      onChange={(event) => change(key, event.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            <button className="primary-button" disabled={busy}>
              {busy ? 'Checking…' : 'Run approved tool'}
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
          {effectiveInput && (
            <p className="order-tool-values">
              Workspace values used:{' '}
              {tool
                .binding!.mappings.map(
                  (mapping) =>
                    `${toolFieldLabel(mapping.inputId)}: ${toolValueText(effectiveInput[mapping.inputId])}`,
                )
                .join(' · ')}
            </p>
          )}
          <ToolResult result={result} preview={preview} />
        </section>
      )}
    </>
  );
}
