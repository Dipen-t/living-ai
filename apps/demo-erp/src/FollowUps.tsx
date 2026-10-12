import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  followUpsApi,
  type FollowUpTask,
  type FollowUpContext,
  type FollowUpInput,
} from './api';
import { customers } from './fixtures';

function FollowUpForm({
  context,
  onSave,
  onClose,
  preview,
}: {
  context: FollowUpContext;
  onSave: (input: FollowUpInput) => Promise<void>;
  onClose: () => void;
  preview: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="customer-dialog"
      aria-labelledby="followup-form-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError('');
          try {
            await onSave({
              customerId: String(data.get('customerId')),
              title: String(data.get('title')).trim(),
              ownerId: String(data.get('ownerId')),
              dueDate: String(data.get('dueDate')),
            });
            onClose();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Couldn’t save this follow-up.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="followup-form-title">Add a follow-up</h2>
        <p>
          {preview
            ? 'Try the workflow here. Preview tasks won’t be saved to your workspace.'
            : 'This task will be saved for your team.'}
        </p>
        <fieldset disabled={busy}>
          <label>
            Customer
            <select name="customerId" required>
              {context.customers.map((customer) => (
                <option value={customer.id} key={customer.id}>
                  {customer.name} · {customer.company}
                </option>
              ))}
            </select>
          </label>
          <label>
            What needs doing?
            <input
              autoFocus
              name="title"
              maxLength={200}
              required
              placeholder="For example: Call about the renewal"
            />
          </label>
          <label>
            Owner
            <select name="ownerId" defaultValue={context.subjectId}>
              {context.owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input name="dueDate" type="date" required />
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="form-buttons">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : preview ? 'Add to preview' : 'Save follow-up'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function FollowUpsPanel({
  preview = false,
  subjectId = 'maya',
  canManage = false,
  onInactive,
}: {
  preview?: boolean;
  subjectId?: string;
  canManage?: boolean;
  onInactive?: () => void;
}) {
  const [tasks, setTasks] = useState<FollowUpTask[]>([]),
    [context, setContext] = useState<FollowUpContext | null>(null);
  const [form, setForm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [view, setView] = useState('mine'),
    [status, setStatus] = useState('pending');
  const createKey = useRef<{ input: string; key: string } | null>(null);
  const mounted = useRef(true);
  async function refresh() {
    if (preview) return;
    try {
      const [context, tasks] = await Promise.all([followUpsApi.context(), followUpsApi.list()]);
      if (mounted.current) {
        setContext(context);
        setTasks(tasks);
        setError('');
      }
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof Error ? error.message : 'Couldn’t load follow-ups.');
        if (error instanceof ApiError && error.code === 'WORKFLOW_INACTIVE') onInactive?.();
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (preview)
      setContext({
        customers: customers.map((customer) => ({
          id: String(customer.id),
          name: String(customer.name),
          company: String(customer.company),
        })),
        owners: [
          { id: 'maya', name: 'Maya' },
          { id: 'arun', name: 'Arun' },
        ],
        subjectId,
        canManage,
      });
    else void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [preview, subjectId, canManage]);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const overdue = (task: FollowUpTask) => task.status === 'pending' && task.dueDate < today;
  const visible = tasks.filter(
    (task) =>
      (view === 'all' || task.ownerId === context?.subjectId) &&
      (status === 'overdue' ? overdue(task) : task.status === status),
  );
  async function change(
    task: FollowUpTask,
    input: { ownerId?: string; status?: 'pending' | 'completed' },
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (preview)
        setTasks((values) =>
          values.map((value) =>
            value.id === task.id ? { ...value, ...input, version: value.version + 1 } : value,
          ),
        );
      else {
        await followUpsApi.update(task, input);
        await refresh();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Couldn’t update this follow-up.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="followup-panel"
      aria-label={preview ? 'Follow-up workflow preview' : 'Customer follow-ups'}
    >
      <div className="followup-heading">
        <div>
          <h2>My follow-ups</h2>
          <p>
            {preview
              ? 'Try assigning and completing tasks before activating this workflow.'
              : 'Keep customer commitments in one place.'}
          </p>
        </div>
        <button
          className="primary-button"
          disabled={!context || busy}
          onClick={() => {
            createKey.current = null;
            setForm(true);
          }}
        >
          Add follow-up
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="followup-controls">
        <label>
          Tasks
          <select value={view} onChange={(event) => setView(event.target.value)}>
            <option value="mine">Assigned to me</option>
            <option value="all">Everyone’s tasks</option>
          </select>
        </label>
        <label>
          Show
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <button disabled={busy} onClick={() => (preview ? setTasks([]) : void refresh())}>
          {preview ? 'Clear preview tasks' : 'Refresh tasks'}
        </button>
      </div>
      <p role="status">
        {visible.length} {visible.length === 1 ? 'follow-up' : 'follow-ups'}
      </p>
      {visible.length === 0 && (
        <p className="empty-state">No {status} follow-ups here. Add a task to get started.</p>
      )}
      <ul className="followup-list">
        {visible.map((task) => (
          <li key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <p>
                {task.customerName} · {task.company}
              </p>
              <span className={overdue(task) ? 'followup-overdue' : ''}>
                {overdue(task) ? 'Overdue · ' : 'Due '}
                {task.dueDate}
              </span>
            </div>
            <label>
              Owner
              <select
                aria-label={`Owner for ${task.title}`}
                value={task.ownerId}
                disabled={busy || (!context?.canManage && task.createdBy !== context?.subjectId)}
                onChange={(event) => void change(task, { ownerId: event.target.value })}
              >
                {context?.owners.map((owner) => (
                  <option value={owner.id} key={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={busy || (!context?.canManage && task.ownerId !== context?.subjectId)}
              onClick={() =>
                void change(task, { status: task.status === 'pending' ? 'completed' : 'pending' })
              }
            >
              {task.status === 'pending' ? 'Mark complete' : 'Reopen'}
            </button>
          </li>
        ))}
      </ul>
      {preview && (
        <p className="field-help">
          Preview tasks are temporary. Saved tasks will use the shared database after activation.
        </p>
      )}
      {form && context && (
        <FollowUpForm
          context={context}
          preview={preview}
          onClose={() => setForm(false)}
          onSave={async (input) => {
            if (preview) {
              const customer = context.customers.find(
                (customer) => customer.id === input.customerId,
              )!;
              setTasks((values) => [
                ...values,
                {
                  ...input,
                  id: crypto.randomUUID(),
                  customerName: customer.name,
                  company: customer.company,
                  status: 'pending',
                  version: 0,
                  createdBy: context.subjectId,
                  completedAt: null,
                },
              ]);
            } else {
              const fingerprint = JSON.stringify(input);
              if (createKey.current?.input !== fingerprint)
                createKey.current = { input: fingerprint, key: crypto.randomUUID() };
              await followUpsApi.create(input, createKey.current.key);
              await refresh();
            }
          }}
        />
      )}
    </section>
  );
}
export function FollowUpsPage({ onInactive }: { onInactive: () => void }) {
  const [account, setAccount] = useState('requester');
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void api
      .session()
      .then((session) => {
        setAccount(session.principal.subjectId === 'arun' ? 'approver' : 'requester');
        setLoaded(true);
      })
      .catch((error) => setError(error.message));
  }, []);
  return (
    <main className="followup-page">
      <h1>Customer follow-ups</h1>
      <label>
        Using the demo as
        <select
          value={account}
          onChange={async (event) => {
            const value = event.target.value;
            setLoaded(false);
            try {
              await api.signIn(value);
              setAccount(value);
              setLoaded(true);
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Couldn’t switch accounts.');
            }
          }}
        >
          <option value="requester">Maya · Requester</option>
          <option value="approver">Arun · Approver</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {loaded && <FollowUpsPanel key={account} onInactive={onInactive} />}
    </main>
  );
}
