import { useEffect, useRef, useState } from 'react';
import type { DemoSession, ToolRecord } from '@evolvekit/core';
import { discountExample } from '@evolvekit/core';
import { createApi, request } from './api';
import './calculators.css';

type Case = { input: ToolRecord; expected: ToolRecord };
type Proposal = {
  id: string;
  request: string;
  cases: Case[];
  state: string;
  lockVersion: number;
  contentHash: string | null;
  summary: string | null;
  source: { featureId: string; files: Record<string, string> } | null;
  error: string | null;
  baseCommit: string;
  report: { passed: number } | null;
  reviewUrl: string | null;
};
type Listing = {
  proposals: Proposal[];
  active: { proposalId: string | null; generation: number };
  releases: { id: string; generation: number; previousProposalId: string | null }[];
};
const api = createApi('customers');
const defaultRequest =
  'Build a late-payment calculator with an original amount, days late, a grace period, and a daily percentage rate. Charge only for days beyond the grace period. A payment within the grace period has no fee. Multiply the original amount by the daily rate and chargeable days, rounding the fee to two decimal places. Show the late fee and total amount due.';
const cases: Case[] = [
  {
    input: { amount: 1000, daysLate: 10, graceDays: 7, dailyRatePercent: 0.1 },
    expected: { fee: 3, total: 1003 },
  },
  {
    input: { amount: 2000, daysLate: 7, graceDays: 7, dailyRatePercent: 0.1 },
    expected: { fee: 0, total: 2000 },
  },
  {
    input: { amount: 1250, daysLate: 9, graceDays: 2, dailyRatePercent: 0.2 },
    expected: { fee: 17.5, total: 1267.5 },
  },
  {
    input: { amount: 0, daysLate: 30, graceDays: 7, dailyRatePercent: 0.1 },
    expected: { fee: 0, total: 0 },
  },
  {
    input: { amount: 1000, daysLate: -2, graceDays: 7, dailyRatePercent: 0.1 },
    expected: { fee: 0, total: 1000 },
  },
];
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
};
const decisionRequest = discountExample.request;
const decisionCases: Case[] = discountExample.cases;
const friendlyName = (name: string) =>
  names[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
const labels: Record<string, string> = {
  Queued: 'Waiting to start',
  Generating: 'Building and checking',
  Ready: 'Ready to try',
  PendingApproval: 'Waiting for review',
  Approved: 'Approved',
  Published: 'Activated',
  Failed: 'Needs a new request',
};
export function CalculatorsPage() {
  const [identity, setIdentity] = useState<DemoSession | null>(null),
    [data, setData] = useState<Listing | null>(null);
  const [text, setText] = useState(defaultRequest),
    [caseText, setCaseText] = useState(JSON.stringify(cases, null, 2));
  const [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [checked, setChecked] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [mode, setMode] = useState<'preview' | 'active'>('preview');
  const [input, setInput] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState(''),
    [result, setResult] = useState<ToolRecord | null>(null);
  const key = useRef<{ text: string; key: string } | null>(null),
    epoch = useRef(0);
  const refresh = async () => {
    setData(await request<Listing>('/v1/code-proposals'));
  };
  useEffect(() => {
    void api
      .session()
      .then(setIdentity)
      .then(refresh)
      .catch((e) => setMessage(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, []);
  const proposal = data?.proposals.find(
    (p) => p.id === (mode === 'active' ? data.active.proposalId : selected),
  );
  useEffect(() => {
    epoch.current++;
    setChecked(false);
    setReviewed(false);
    setPreview('');
    setResult(null);
    setInput(
      Object.fromEntries(
        Object.entries(proposal?.cases[0].input ?? {}).map(([key, value]) => [key, String(value)]),
      ),
    );
  }, [proposal?.id, proposal?.contentHash, mode, identity?.principal.subjectId]);
  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };
  const can = (permission: DemoSession['permissions'][number]) =>
    identity?.permissions.includes(permission);
  const ready =
    proposal && ['Ready', 'PendingApproval', 'Approved', 'Published'].includes(proposal.state);
  const action = () => ({
    contentHash: proposal!.contentHash,
    expectedVersion: proposal!.lockVersion,
  });
  const route = (name: string) => '/v1/code-proposals/' + proposal!.id + '/' + name;
  return (
    <main className="calculator-page">
      <header className="calculator-intro">
        <div>
          <h1>Make room for a new idea.</h1>
          <p>
            Build a calculator or decision tool, try its results, and review it before adding it to
            your workspace.
          </p>
        </div>
        <label>
          Using the demo as
          <select
            value={identity?.principal.subjectId === 'arun' ? 'approver' : 'requester'}
            disabled={busy}
            onChange={(event) =>
              void act(async () => {
                setIdentity(await api.signIn(event.target.value));
              }, 'Account switched.')
            }
          >
            <option value="requester">Maya · Requester</option>
            <option value="approver">Arun · Reviewer</option>
          </select>
        </label>
      </header>
      {message && (
        <p className="calculator-message" role="status">
          {message}
        </p>
      )}
      <div className="calculator-modes">
        <button aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>
          Try a new tool
        </button>
        <button aria-pressed={mode === 'active'} onClick={() => setMode('active')}>
          Your active tool
        </button>
      </div>
      {mode === 'preview' && (
        <>
          {can('code:request') && (
            <section className="calculator-request">
              <h2>What should your tool do?</h2>
              <label>
                Start with an example
                <select
                  defaultValue="calculator"
                  disabled={busy}
                  onChange={(event) => {
                    const decision = event.target.value === 'decision';
                    setText(decision ? decisionRequest : defaultRequest);
                    setCaseText(JSON.stringify(decision ? decisionCases : cases, null, 2));
                  }}
                >
                  <option value="calculator">Late-payment calculator</option>
                  <option value="decision">Discount eligibility · free built-in example</option>
                </select>
              </label>
              <p className="calculator-note">
                The built-in discount example works without AI. Custom ideas and changed rules use
                Gemini.
              </p>
              <label>
                Your tool idea
                <textarea
                  rows={5}
                  value={text}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <details>
                <summary>Expected results for review</summary>
                <p>
                  These examples check the generated code. Change them when you change the rule.
                  Include at least three.
                </p>
                <label>
                  Input and expected output examples
                  <textarea
                    className="calculator-cases"
                    rows={10}
                    value={caseText}
                    onChange={(e) => setCaseText(e.target.value)}
                  />
                </label>
              </details>
              <button
                className="primary-button"
                disabled={busy || !text.trim()}
                onClick={() =>
                  void act(async () => {
                    const parsed = JSON.parse(caseText),
                      fingerprint = JSON.stringify({ text, parsed });
                    if (proposal?.state === 'Failed') key.current = null;
                    if (key.current?.text !== fingerprint)
                      key.current = { text: fingerprint, key: crypto.randomUUID() };
                    const p = await request<Proposal>(
                      '/v1/code-proposals',
                      { request: text, cases: parsed },
                      key.current.key,
                    );
                    setSelected(p.id);
                  }, 'Your tool is being built. You can leave this page and return later.')
                }
              >
                Build a preview
              </button>
            </section>
          )}
          <label className="calculator-draft-choice">
            Choose a saved draft
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)}>
              <option value="">Choose a draft</option>
              {data?.proposals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.summary?.slice(0, 70) ?? p.request.slice(0, 70)} — {labels[p.state]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {proposal && (
        <section className="calculator-workbench">
          <header>
            <h2>{mode === 'active' ? 'Your tool' : 'Try this tool'}</h2>
            <span>{labels[proposal.state]}</span>
          </header>
          <p>{proposal.summary ?? proposal.request}</p>
          {proposal.error && <p role="alert">{proposal.error}</p>}
          {['Queued', 'Generating'].includes(proposal.state) && (
            <p role="status">
              We’re generating the source and checking your examples. Your workspace hasn’t changed.
            </p>
          )}
          {ready && (
            <>
              <div className="calculator-inputs">
                {Object.entries(input).map(([name, value]) => (
                  <label key={name}>
                    {friendlyName(name)}
                    {typeof proposal.cases[0].input[name] === 'boolean' ? (
                      <select
                        value={value}
                        disabled={busy}
                        onChange={(event) => {
                          epoch.current++;
                          setInput({ ...input, [name]: event.target.value });
                          setPreview('');
                          setResult(null);
                          setChecked(false);
                        }}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    ) : (
                      <input
                        type={typeof proposal.cases[0].input[name] === 'number' ? 'number' : 'text'}
                        maxLength={500}
                        step="any"
                        value={value}
                        disabled={busy}
                        onChange={(e) => {
                          epoch.current++;
                          setInput({ ...input, [name]: e.target.value });
                          setPreview('');
                          setResult(null);
                          setChecked(false);
                        }}
                      />
                    )}
                  </label>
                ))}
              </div>
              <button
                disabled={
                  busy ||
                  Object.entries(input).some(
                    ([key, value]) =>
                      typeof proposal.cases[0].input[key] === 'number' &&
                      (value.trim() === '' || !Number.isFinite(Number(value))),
                  )
                }
                onClick={() =>
                  void act(async () => {
                    const current = epoch.current;
                    const value = await request<{
                      result: ToolRecord;
                      preview: string;
                      proposalId: string;
                    }>('/v1/code-evaluate', {
                      proposalId: mode === 'active' ? null : proposal.id,
                      input: Object.fromEntries(
                        Object.entries(input).map(([k, v]) => [
                          k,
                          typeof proposal.cases[0].input[k] === 'number'
                            ? Number(v)
                            : typeof proposal.cases[0].input[k] === 'boolean'
                              ? v === 'true'
                              : v,
                        ]),
                      ),
                    });
                    if (current !== epoch.current) return;
                    if (value.proposalId !== proposal.id)
                      throw new Error('The active tool changed. Refresh and try again.');
                    setPreview(value.preview);
                    setResult(value.result);
                  }, 'Tool finished.')
                }
              >
                Try these inputs
              </button>
              {result && (
                <div className="calculator-results" aria-live="polite">
                  {Object.entries(result).map(([name, value]) => (
                    <p key={name}>
                      <span>
                        {name === 'fee'
                          ? 'Late fee'
                          : name === 'total'
                            ? 'Total amount'
                            : friendlyName(name)}
                      </span>
                      <strong>
                        {typeof value === 'number'
                          ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(
                              value,
                            )
                          : typeof value === 'boolean'
                            ? value
                              ? 'Yes'
                              : 'No'
                            : value}
                      </strong>
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
              <p className="calculator-note">
                {mode === 'preview'
                  ? String(proposal.report?.passed ?? 0) +
                    ' examples passed. Preview runs do not change your workspace.'
                  : 'This tool runs the exact approved source in isolation.'}
              </p>
              <details className="calculator-source">
                <summary>Review the generated source</summary>
                {proposal.reviewUrl && (
                  <p>
                    <a href={proposal.reviewUrl} target="_blank" rel="noreferrer">
                      Open source review on GitHub
                    </a>
                  </p>
                )}
                <p>
                  Review these files and the example results before approving. Approval belongs to
                  this exact version.
                </p>
                {Object.entries(proposal.source?.files ?? {}).map(([name, code]) => (
                  <div key={name}>
                    <h3>{name}</h3>
                    <pre>{code}</pre>
                  </div>
                ))}
                <p>
                  Base commit: <code>{proposal.baseCommit}</code>
                </p>
                <p>
                  Source fingerprint: <code>{proposal.contentHash}</code>
                </p>
              </details>
              {mode === 'preview' && proposal.state === 'Ready' && can('code:submit') && (
                <div className="calculator-review">
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                    />{' '}
                    I’ve tried the tool and checked the results
                  </label>
                  <button
                    disabled={busy || !checked || !result}
                    onClick={() =>
                      void act(() => request(route('submit'), action()), 'Sent for code review.')
                    }
                  >
                    Send for review
                  </button>
                </div>
              )}
              {mode === 'preview' &&
                proposal.state === 'PendingApproval' &&
                can('code:approve') && (
                  <div className="calculator-review">
                    <label>
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />{' '}
                      I’ve reviewed this exact source and its example results
                    </label>
                    <button
                      disabled={busy || !reviewed}
                      onClick={() =>
                        void act(
                          () => request(route('approve'), action()),
                          'This version is approved. You can activate it separately.',
                        )
                      }
                    >
                      Approve this version
                    </button>
                  </div>
                )}
              {mode === 'preview' && proposal.state === 'Approved' && can('code:activate') && (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        request(route('activate'), {
                          ...action(),
                          expectedGeneration: data!.active.generation,
                        }),
                      'Tool activated in this demo workspace.',
                    )
                  }
                >
                  Activate tool
                </button>
              )}
            </>
          )}
        </section>
      )}
      {mode === 'active' && !proposal && (
        <p className="calculator-empty">
          No tool is active yet. Try a draft and have its source approved first.
        </p>
      )}
      {mode === 'active' && data?.releases[0] && can('code:rollback') && (
        <section className="calculator-restore">
          <h2>Restore the previous version</h2>
          <p>
            Switch back to the tool used before the latest change. Saved drafts and review history
            stay available.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  request('/v1/code-rollback', {
                    releaseId: data.releases[0].id,
                    expectedGeneration: data.active.generation,
                  }),
                'Previous tool restored.',
              )
            }
          >
            Restore previous version
          </button>
        </section>
      )}
    </main>
  );
}
