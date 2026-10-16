import type { ToolRecord, ToolValue } from '@evolvekit/core';
const names: Record<string, string> = {
  amount: 'Original amount',
  daysLate: 'Days late',
  graceDays: 'Grace period (days)',
  dailyRatePercent: 'Daily rate (%)',
  customerTier: 'Customer tier',
  orderAmount: 'Order amount',
  overdue: 'Overdue payment?',
  eligible: 'Eligible for discount',
  discountPercent: 'Discount (%)',
  reason: 'Reason',
  fee: 'Late fee',
  total: 'Total amount',
};
export const toolFieldLabel = (name: string) =>
  names[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
export const toolValueText = (value: ToolValue) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)
    : typeof value === 'boolean'
      ? value
        ? 'Yes'
        : 'No'
      : value;
export function ToolResult({ result, preview }: { result: ToolRecord | null; preview: string }) {
  return (
    <>
      {result && (
        <div className="calculator-results" aria-live="polite">
          {Object.entries(result).map(([name, value]) => (
            <p key={name}>
              <span>{toolFieldLabel(name)}</span>
              <strong>{toolValueText(value)}</strong>
            </p>
          ))}
        </div>
      )}
      {preview && (
        <iframe
          title="Generated tool result"
          className="calculator-frame"
          sandbox=""
          srcDoc={
            "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\"><style>body{font:16px system-ui;color:#183640;margin:20px;line-height:1.6}</style></head><body>" +
            preview +
            '</body></html>'
          }
        />
      )}
    </>
  );
}
