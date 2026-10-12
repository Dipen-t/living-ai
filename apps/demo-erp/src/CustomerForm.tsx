import { useEffect, useRef, useState } from 'react';

export interface DemoCustomer extends Record<string, unknown> {
  id: string;
  name: string;
  company: string;
  region: string;
  lastPurchaseAt: string | null;
  revenue: number;
}
export const customerStorageKey = 'evolvekit-demo-customers-v1';
export function readDemoCustomers(): DemoCustomer[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(customerStorageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (row): row is DemoCustomer =>
          row &&
          typeof row.id === 'string' &&
          row.id.startsWith('demo-') &&
          typeof row.name === 'string' &&
          typeof row.company === 'string' &&
          typeof row.region === 'string' &&
          typeof row.revenue === 'number' &&
          Number.isFinite(row.revenue) &&
          (row.lastPurchaseAt === null ||
            (typeof row.lastPurchaseAt === 'string' &&
              Number.isFinite(Date.parse(row.lastPurchaseAt)))),
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}
export function CustomerForm({
  preview,
  onSave,
  onClose,
}: {
  preview: boolean;
  onSave: (row: DemoCustomer) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="customer-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="customer-form-title"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get('name')).trim();
          const company = String(data.get('company')).trim();
          const revenue = Number(data.get('revenue'));
          if (!name || !company || !Number.isFinite(revenue) || revenue < 0) {
            setError('Enter a customer, company, and valid revenue amount.');
            return;
          }
          try {
            const date = String(data.get('date') ?? '');
            onSave({
              id: `demo-${crypto.randomUUID()}`,
              name,
              company,
              region: String(data.get('region')),
              revenue,
              lastPurchaseAt: date ? new Date(`${date}T00:00:00Z`).toISOString() : null,
            });
            onClose();
          } catch {
            setError('Couldn’t save this demo customer. Your browser storage may be full.');
          }
        }}
      >
        <h2 id="customer-form-title">{preview ? 'Try adding a customer' : 'Add a customer'}</h2>
        <p>
          {preview
            ? 'This customer appears only in the preview. Your workspace won’t change.'
            : 'Demo customers are saved in this browser. They aren’t shared with other accounts or devices.'}
        </p>
        <label>
          Customer name
          <input name="name" autoFocus required maxLength={120} />
        </label>
        <label>
          Company
          <input name="company" required maxLength={120} />
        </label>
        <label>
          Region
          <select name="region">
            <option>West</option>
            <option>South</option>
            <option>North</option>
            <option>East</option>
          </select>
        </label>
        <label>
          Last purchase
          <input type="date" name="date" />
        </label>
        <label>
          Revenue (₹)
          <input name="revenue" type="number" min="0" step="0.01" defaultValue="0" required />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="form-buttons">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">{preview ? 'Add to preview' : 'Save customer'}</button>
        </div>
      </form>
    </dialog>
  );
}
