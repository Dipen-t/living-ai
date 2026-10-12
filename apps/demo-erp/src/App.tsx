import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyOperations,
  buildTableModel,
  canonicalize,
  validateConfiguration,
  resolveActions,
  type ActionConfiguration,
  type ActionPosition,
  type ConfigurationEnvelope,
  type ConfigurationHistory,
  type DemoSession,
  type Permission,
  type RevisionEnvelope,
  type RuntimeOperation,
  type TableConfiguration,
  type PlannerJobEnvelope,
} from '@evolvekit/core';
import { EvolveProvider, EvolvePreview, EvolvableTable } from '@evolvekit/react';
import {
  customers,
  orders,
  evaluationTime,
  registry,
  legacyRegistry,
  numberFormatRegistry,
  ordersRegistry,
  actionRegistry,
  followUpsRegistry,
} from './fixtures';
import { createApi, ApiError } from './api';
import './backend.css';
import { FollowUpsPanel, FollowUpsPage } from './FollowUps';
import { CalculatorsPage } from './Calculators';
import {
  CustomerForm,
  readDemoCustomers,
  customerStorageKey,
  type DemoCustomer,
} from './CustomerForm';

async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalize(value)),
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function validateEnvelope(
  envelope: ConfigurationEnvelope | RevisionEnvelope,
  page: (typeof registry.pages)[number],
) {
  const validated = validateConfiguration(envelope.configuration, page);
  if (
    !validated.success ||
    ![
      await hash(registry),
      await hash(legacyRegistry),
      await hash(numberFormatRegistry),
      await hash(ordersRegistry),
      await hash(actionRegistry),
      await hash(followUpsRegistry),
    ].includes(envelope.registryVersionId) ||
    envelope.configurationHash !== (await hash(envelope.configuration))
  )
    throw new Error(
      'Configuration is incompatible with this SDK integration. The last working table remains available.',
    );
  return envelope;
}
const editable = ['ReadyForPreview', 'PendingApproval', 'Approved'];
function plannerFailureMessage(code: string | null | undefined) {
  if (code === 'PROVIDER_QUOTA')
    return 'The assistant has reached its request limit. Try again later, or use the manual options.';
  if (code === 'PROVIDER_AUTH')
    return 'The assistant couldn’t connect with the saved API key. Check the key, or use the manual options.';
  if (code === 'PLANNER_TIMEOUT')
    return 'The assistant took too long to respond. Try starting over with a shorter request.';
  if (
    ['INVALID_CANDIDATE', 'INVALID_PROVIDER_RESPONSE', 'PROVIDER_INCOMPLETE'].includes(code ?? '')
  )
    return 'The assistant returned a suggestion we couldn’t use. Try describing the change differently. Your workspace hasn’t changed.';
  return 'The assistant couldn’t finish this request. Try starting over, or use the manual options. Your workspace hasn’t changed.';
}
const stateLabels: Record<string, string> = {
  ReadyForPreview: 'Ready to review',
  PendingApproval: 'Waiting for approval',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Published: 'Published',
  Superseded: 'Updated with a newer draft',
  PublicationConflict: 'Needs an update',
  RolledBack: 'Replaced by an earlier version',
};

export default function App() {
  const [pageId, setPageId] = useState('customers');
  const [followUpsEnabled, setFollowUpsEnabled] = useState(false);
  useEffect(() => {
    if (pageId === 'followups' && !followUpsEnabled) setPageId('customers');
  }, [pageId, followUpsEnabled]);
  return (
    <>
      <nav className="workspace-pages" aria-label="Workspace pages">
        <button
          aria-current={pageId === 'calculators' ? 'page' : undefined}
          onClick={() => setPageId('calculators')}
        >
          Calculators
        </button>
        {['customers', 'orders'].map((id) => (
          <button
            key={id}
            aria-current={pageId === id ? 'page' : undefined}
            onClick={() => setPageId(id)}
          >
            {id === 'customers' ? 'Customers' : 'Orders'}
          </button>
        ))}
        {followUpsEnabled && (
          <button
            aria-current={pageId === 'followups' ? 'page' : undefined}
            onClick={() => setPageId('followups')}
          >
            My follow-ups
          </button>
        )}
      </nav>
      {pageId === 'calculators' ? (
        <CalculatorsPage />
      ) : pageId === 'followups' ? (
        <FollowUpsPage onInactive={() => setFollowUpsEnabled(false)} />
      ) : (
        <Workspace key={pageId} pageId={pageId} onFollowUpsEnabled={setFollowUpsEnabled} />
      )}
    </>
  );
}
function Workspace({
  pageId,
  onFollowUpsEnabled,
}: {
  pageId: string;
  onFollowUpsEnabled: (value: boolean) => void;
}) {
  const page = registry.pages.find((p) => p.pageId === pageId)!;
  const baseline = page.baseline;
  const api = useMemo(() => createApi(pageId), [pageId]);
  const [addedCustomers, setAddedCustomers] = useState(readDemoCustomers);
  const [previewCustomers, setPreviewCustomers] = useState<DemoCustomer[]>([]);
  const [customerForm, setCustomerForm] = useState<'active' | 'preview' | null>(null);
  const rows = pageId === 'customers' ? [...customers, ...addedCustomers] : orders;
  const [actionDraft, setActionDraft] = useState<ActionConfiguration[]>(
    resolveActions(baseline, page),
  );
  const [followUpsRequested, setFollowUpsRequested] = useState(false);
  const noun = pageId === 'customers' ? 'customers' : 'orders';
  const title = pageId === 'customers' ? 'Customers' : 'Orders';
  const singular = pageId === 'customers' ? 'customer' : 'order';
  const numberField = page.fields.find((f) => f.type === 'number')!.id;
  const numberLabel = pageId === 'customers' ? 'Revenue' : 'Amount';
  const dateField = page.fields.find((f) => f.type === 'date')!.id;
  const viewName = pageId === 'customers' ? 'Customer follow-up' : 'Order follow-up';
  const capability = (kind: RuntimeOperation['kind']) =>
    page.operations.find((op) => op.kind === kind)!.id;
  const checkEnvelope = (envelope: ConfigurationEnvelope | RevisionEnvelope) =>
    validateEnvelope(envelope, page);
  const [active, setActive] = useState<ConfigurationEnvelope | null>(null);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [account, setAccount] = useState('requester');
  const [revision, setRevision] = useState<RevisionEnvelope | null>(null);
  const [proposals, setProposals] = useState<RevisionEnvelope[]>([]);
  const [plannerMode, setPlannerMode] = useState('unconfigured');
  const [requestText, setRequestText] = useState('');
  const [jobs, setJobs] = useState<PlannerJobEnvelope[]>([]);
  const [watchedJob, setWatchedJob] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<PlannerJobEnvelope | null>(null);
  const [history, setHistory] = useState<ConfigurationHistory>({ versions: [], activations: [] });
  const [draftBase, setDraftBase] = useState<TableConfiguration>(baseline);
  const [draftGeneration, setDraftGeneration] = useState(1);
  const [days, setDays] = useState(90),
    [filterEnabled, setFilterEnabled] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]),
    [order, setOrder] = useState(baseline.columns.map((c) => c.fieldId));
  const [saved, setSaved] = useState(false),
    [preview, setPreview] = useState(false),
    [json, setJson] = useState(false);
  const [revenueFormat, setRevenueFormat] =
    useState<NonNullable<TableConfiguration['columns'][number]['numberFormat']>>('indian');
  const [manual, setManual] = useState(''),
    [manualError, setManualError] = useState('');
  const [customOps, setCustomOps] = useState<RuntimeOperation[] | null>(null);
  const [description, setDescription] = useState(`Add a ${singular} follow-up view`);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('Opening your workspace…');
  const [audit, setAudit] = useState<
    { id: string; eventType: string; actorId: string; createdAt: string }[]
  >([]);
  const mounted = useRef(true),
    revisionRef = useRef<RevisionEnvelope | null>(null);
  const retryKeys = useRef(new Map<string, string>());
  const permitted = (permission: Permission) => !!session?.permissions.includes(permission);
  const baseGeneration = draftGeneration;

  function loadRevision(
    value: RevisionEnvelope | null,
    config: TableConfiguration,
    generation = active?.generation ?? 1,
  ) {
    revisionRef.current = value;
    setRevision(value);
    setPreview(!!value);
    setAcknowledged(false);
    const base = value?.baseConfiguration ?? config;
    setDraftBase(base);
    setCustomOps(value?.operations ?? null);
    setDraftGeneration(value?.baseGeneration ?? generation);
    if (value) setDescription(value.text);
    if (value) setRequestText('');
    const filter = value?.operations.find(
      (op) => op.kind === 'add_filter' && op.filter.operator === 'older_than_days',
    );
    setDays(filter?.kind === 'add_filter' ? Number(filter.filter.value) : 90);
    setFilterEnabled(value ? !!filter : config.filters.length === 0);
    setSaved(value?.operations.some((op) => op.kind === 'create_saved_view') ?? false);
    const columns = value?.configuration.columns ?? config.columns;
    setActionDraft(resolveActions(value?.configuration ?? config, page));
    setFollowUpsRequested(
      (value?.configuration ?? config).enabledFeatures?.includes('customer-followups') ?? false,
    );
    setPreviewCustomers([]);
    setRevenueFormat(
      columns.find((column) => column.fieldId === numberField)?.numberFormat ?? 'indian',
    );
    setOrder(columns.map((c) => c.fieldId));
    setHidden(columns.filter((c) => !c.visible).map((c) => c.fieldId));
  }
  async function refresh(selectedId: string | null = revisionRef.current?.proposalId ?? null) {
    const [current, drafts, log, planner, jobList] = await Promise.all([
      api.active(),
      api.proposals(),
      api.history(),
      api.planner(),
      api.jobs(),
    ]);
    await checkEnvelope(current);
    if (!mounted.current) return;
    setActive(current);
    setProposals(drafts);
    setHistory(log);
    setPlannerMode(planner.mode);
    setJobs(jobList);
    const selected = selectedId ? (drafts.find((r) => r.proposalId === selectedId) ?? null) : null;
    if (selected) await checkEnvelope(selected);
    loadRevision(selected, current.configuration, current.generation);
  }
  useEffect(() => {
    mounted.current = true;
    async function boot() {
      try {
        let identity;
        try {
          identity = await api.session();
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 401) throw e;
          identity = await api.signIn('requester');
        }
        if (!mounted.current) return;
        setSession(identity);
        setAccount(identity.principal.subjectId === 'arun' ? 'approver' : 'requester');
        await refresh();
        setMessage('Your workspace is ready.');
      } catch (e) {
        if (mounted.current) {
          setError(e instanceof Error ? e.message : 'Backend unavailable.');
          setMessage('Baseline remains available. Start the demo API to save changes.');
        }
      }
    }
    void boot();
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const value = (await checkEnvelope(await api.active())) as ConfigurationEnvelope;
        if (mounted.current) setActive(value);
      } catch {
        /* Keep the last compatible active configuration. */
      }
    };
    const timer = setInterval(() => void poll(), 15000);
    window.addEventListener('focus', poll);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, []);
  useEffect(() => {
    if (!watchedJob) return;
    let cancelled = false,
      inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = await api.job(watchedJob);
        if (cancelled) return;
        setSelectedJob(value);
        setJobs((items) => [value, ...items.filter((job) => job.jobId !== value.jobId)]);
        if (!['Queued', 'Running'].includes(value.status)) {
          if (value.status === 'Succeeded') {
            await refresh(value.proposalId);
            if (!cancelled) {
              setPreview(true);
              setMessage('Your preview is ready. Take a look below.');
            }
          } else
            setMessage(
              value.status === 'Failed'
                ? plannerFailureMessage(value.resultCode)
                : (value.message ?? 'Add a little more detail and try again.'),
            );
          if (!cancelled) setWatchedJob(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not read generation status.');
          setWatchedJob(null);
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void poll(), 1500);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watchedJob]);

  const proposal = useMemo(() => {
    const operations: RuntimeOperation[] = customOps
      ? structuredClone(customOps)
      : [
          ...(filterEnabled
            ? [
                {
                  capabilityId: capability('add_filter'),
                  kind: 'add_filter' as const,
                  filter: {
                    id: `inactive-${baseGeneration}`,
                    label:
                      pageId === 'customers'
                        ? `No purchase in ${days} days`
                        : `Ordered more than ${days} days ago`,
                    fieldId: dateField,
                    operator: 'older_than_days' as const,
                    value: days,
                  },
                },
              ]
            : []),
          ...hidden.map((fieldId) => ({
            capabilityId: capability('set_column_visibility'),
            kind: 'set_column_visibility' as const,
            fieldId,
            visible: false,
          })),
          ...draftBase.columns
            .filter((c) => !c.visible && !hidden.includes(c.fieldId))
            .map((c) => ({
              capabilityId: capability('set_column_visibility'),
              kind: 'set_column_visibility' as const,
              fieldId: c.fieldId,
              visible: true,
            })),
          { capabilityId: capability('reorder_columns'), kind: 'reorder_columns', fieldIds: order },
          ...(revenueFormat !==
          (draftBase.columns.find((column) => column.fieldId === numberField)?.numberFormat ??
            'indian')
            ? [
                {
                  capabilityId: capability('set_number_format'),
                  kind: 'set_number_format' as const,
                  fieldId: numberField,
                  format: revenueFormat,
                },
              ]
            : []),
        ];
    try {
      if (
        !customOps &&
        page.features?.some((feature) => feature.id === 'customer-followups') &&
        followUpsRequested !== (draftBase.enabledFeatures?.includes('customer-followups') ?? false)
      )
        operations.push({
          kind: 'set_feature',
          capabilityId: capability('set_feature'),
          featureId: 'customer-followups',
          enabled: followUpsRequested,
        });
      if (!customOps)
        for (const action of actionDraft) {
          const original = resolveActions(draftBase, page).find(
            (value) => value.actionId === action.actionId,
          );
          if (canonicalize(action) !== canonicalize(original))
            operations.push({
              capabilityId: capability('set_action'),
              kind: 'set_action',
              ...action,
            });
        }
      let configuration = applyOperations(draftBase, operations, page);
      if (saved && !customOps) {
        operations.push({
          capabilityId: capability('create_saved_view'),
          kind: 'create_saved_view',
          view: {
            id: `follow-up-${baseGeneration}`,
            name: viewName,
            configuration: {
              columns: configuration.columns,
              filters: configuration.filters,
              sort: configuration.sort,
            },
          },
        });
        configuration = applyOperations(draftBase, operations, page);
      }
      return { configuration, operations, error: '' };
    } catch (e) {
      return {
        configuration: null,
        operations,
        error: e instanceof Error ? e.message : 'Invalid configuration.',
      };
    }
  }, [
    customOps,
    filterEnabled,
    baseGeneration,
    days,
    hidden,
    order,
    draftBase,
    saved,
    revenueFormat,
    actionDraft,
    followUpsRequested,
  ]);
  const dirty =
    !!revision && canonicalize(proposal.operations) !== canonicalize(revision.operations);
  const currentConfig = active?.configuration ?? baseline;
  useEffect(() => {
    if (pageId === 'customers')
      onFollowUpsEnabled(currentConfig.enabledFeatures?.includes('customer-followups') ?? false);
  }, [pageId, active?.versionId]);
  const matching = proposal.configuration
    ? buildTableModel([...rows, ...previewCustomers], proposal.configuration, page, {
        evaluationTime,
      }).rows.length
    : 0;
  const canSave =
    permitted('evolution:request') && (!revision || editable.includes(revision.state));
  function edit() {
    setCustomOps(null);
    setAcknowledged(false);
  }
  function keyFor(kind: string, payload: unknown) {
    const fingerprint = `${kind}:${canonicalize(payload)}`;
    let key = retryKeys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      retryKeys.current.set(fingerprint, key);
    }
    return key;
  }
  async function perform(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    try {
      await work();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
      if (e instanceof ApiError && e.status === 409) {
        try {
          await refresh();
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    await perform(
      async () => {
        const value = revision
          ? await api.refine(
              revision,
              proposal.operations,
              description,
              keyFor('refine', {
                id: revision.revisionId,
                lockVersion: revision.lockVersion,
                operations: proposal.operations,
                description,
              }),
            )
          : await api.create(
              proposal.operations,
              draftGeneration,
              description,
              keyFor('create', {
                generation: draftGeneration,
                operations: proposal.operations,
                description,
              }),
            );
        await refresh(value.proposalId);
      },
      revision
        ? 'Your updated draft is ready to review.'
        : 'Your draft is saved and ready to review.',
    );
  }
  async function generateProposal() {
    await perform(async () => {
      const payload = revision
        ? { revisionId: revision.revisionId, lockVersion: revision.lockVersion, text: requestText }
        : { generation: draftGeneration, text: requestText };
      const value = revision
        ? await api.generateRefinement(revision, requestText, keyFor('generate-refine', payload))
        : await api.generate(requestText, draftGeneration, keyFor('generate', payload));
      setSelectedJob(value);
      setJobs((items) => [value, ...items.filter((job) => job.jobId !== value.jobId)]);
      setWatchedJob(value.jobId);
      setPreview(false);
      setAcknowledged(false);
    }, 'Creating your preview…');
  }
  async function review(kind: 'submit' | 'approve' | 'reject') {
    await perform(
      async () => {
        await api[kind](revision!);
        await refresh();
      },
      kind === 'submit'
        ? 'Sent for approval.'
        : kind === 'approve'
          ? 'Approved. You can now apply this change.'
          : 'Change declined.',
    );
  }
  function reset() {
    setError('');
    setMessage(active ? 'Your workspace is ready.' : 'Opening your workspace…');
    // An explicit new proposal is a new intent, even when its text is identical.
    for (const fingerprint of retryKeys.current.keys()) {
      if (fingerprint.startsWith('generate:') || fingerprint.startsWith('generate-refine:'))
        retryKeys.current.delete(fingerprint);
    }
    loadRevision(null, currentConfig);
    setManualError('');
    setDescription(`Add a ${singular} follow-up view`);
    setPreview(false);
    setWatchedJob(null);
    setSelectedJob(null);
    setRequestText('');
  }
  function validateManual() {
    try {
      const input: unknown = JSON.parse(manual);
      applyOperations(draftBase, input, page);
      setCustomOps(input as RuntimeOperation[]);
      setManualError('');
      setAcknowledged(false);
      setPreview(true);
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Enter a valid JSON operation array.');
    }
  }
  return (
    <EvolveProvider
      registry={registry}
      configurations={{ [pageId]: currentConfig }}
      evaluationTime={evaluationTime}
    >
      <header className="app-header">
        <a className="brand" href="#main">
          <span className="brand-mark" aria-hidden="true">
            e
          </span>
          EvolveKit
        </a>
        <span className="header-caption">Make your workspace work for you</span>
        <span className="environment">Demo workspace</span>
      </header>
      <main id="main">
        <div className="page-heading">
          <div>
            <h1>
              {account === 'approver' ? 'Review workspace changes.' : `Your ${noun}, your way.`}
            </h1>
            <p className="intro">
              {account === 'approver'
                ? 'Take a look at the preview, then decide whether to approve it.'
                : 'Tell us what would help. Try it out before changing anything.'}
            </p>
          </div>
        </div>
        <div className="session-bar">
          <div>
            <strong>Try both sides of the demo</strong>
            <p>Maya suggests changes. Arun approves them.</p>
          </div>
          <label>
            Using the demo as
            <select
              aria-label="Demo account"
              value={account}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value;
                void perform(async () => {
                  const identity = await api.signIn(value);
                  setSession(identity);
                  setAccount(value);
                  setWatchedJob(null);
                  setSelectedJob(null);
                  await refresh();
                }, 'Demo account switched.');
              }}
            >
              <option value="requester">Maya · Requester</option>
              <option value="approver">Arun · Approver</option>
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const identity = await api.session();
                setSession(identity);
                await refresh();
              }, 'Workspace refreshed.')
            }
          >
            Refresh
          </button>
        </div>
        <p className="connection-status" role="status">
          {message}
        </p>
        {error && (
          <div role="alert" className="validation-error">
            {error}
          </div>
        )}
        <div className="workspace">
          {account === 'approver' ? (
            <section className="proposal-panel" aria-labelledby="review-heading">
              <h2 id="review-heading">Choose a change to review</h2>
              <label className="proposal-selector">
                Saved changes
                <select
                  aria-label="Change to review"
                  value={revision?.proposalId ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    loadRevision(
                      proposals.find((p) => p.proposalId === e.target.value) ?? null,
                      currentConfig,
                    )
                  }
                >
                  <option value="">Choose a change</option>
                  {proposals.map((p) => (
                    <option key={p.proposalId} value={p.proposalId}>
                      {p.text.slice(0, 60)} · {stateLabels[p.state]}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          ) : (
            <aside className="proposal-panel" aria-labelledby="proposal-heading">
              <div className="panel-heading">
                <h2 id="proposal-heading">What would you like to change?</h2>
                <button className="text-button" disabled={busy} onClick={reset}>
                  Start over
                </button>
              </div>
              <section className="planner-panel" aria-labelledby="planner-heading">
                <div className="planner-title">
                  <h3 id="planner-heading" className="sr-only">
                    Describe your change
                  </h3>
                  <span>
                    {plannerMode === 'gemini'
                      ? 'AI assistant'
                      : plannerMode === 'local'
                        ? 'Basic assistant'
                        : 'Assistant offline'}
                  </span>
                </div>
                <p>
                  {plannerMode === 'local'
                    ? `Try hiding a column, changing its position, or filtering ${noun} by date.`
                    : plannerMode === 'gemini'
                      ? 'Describe it in your own words. You’ll see a preview first.'
                      : 'The assistant is offline. You can still make a change using the options below.'}
                </p>
                <label className="request-label">
                  {revision ? 'Want to adjust this draft?' : 'Your idea'}
                  <textarea
                    aria-label="Proposal request"
                    rows={3}
                    maxLength={4000}
                    value={requestText}
                    disabled={busy || !!watchedJob}
                    onChange={(e) => setRequestText(e.target.value)}
                    placeholder={
                      pageId === 'customers'
                        ? 'For example: Add customer follow-ups with an owner, due date, and completion status'
                        : 'For example: Show orders with status Pending and add commas to the amount'
                    }
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    !!watchedJob ||
                    !active ||
                    !requestText.trim() ||
                    plannerMode === 'unconfigured' ||
                    !(revision
                      ? permitted('evolution:refine') && editable.includes(revision.state)
                      : permitted('evolution:request'))
                  }
                  onClick={() => void generateProposal()}
                >
                  {watchedJob
                    ? 'Creating your preview…'
                    : revision
                      ? 'Update preview'
                      : 'Preview my change'}
                </button>
                {jobs.length > 0 && (
                  <details className="past-requests">
                    <summary>Previous requests</summary>
                    <label className="proposal-selector">
                      Choose a request
                      <select
                        aria-label="Generation history"
                        value={selectedJob?.jobId ?? ''}
                        disabled={busy}
                        onChange={(e) => {
                          const job = jobs.find((item) => item.jobId === e.target.value) ?? null;
                          setSelectedJob(job);
                          setWatchedJob(
                            job && ['Queued', 'Running'].includes(job.status) ? job.jobId : null,
                          );
                        }}
                      >
                        <option value="">Choose a request</option>
                        {jobs.map((job) => (
                          <option key={job.jobId} value={job.jobId}>
                            {
                              {
                                Queued: 'Waiting',
                                Running: 'Creating preview',
                                Succeeded: 'Preview ready',
                                Unsupported: 'Not available yet',
                                NeedsClarification: 'Needs more detail',
                                Failed: 'Couldn’t create preview',
                              }[job.status]
                            }{' '}
                            · {new Date(job.createdAt).toLocaleTimeString()}
                          </option>
                        ))}
                      </select>
                    </label>
                  </details>
                )}
                {selectedJob && (
                  <div className="planner-result" role="status">
                    <strong>
                      {selectedJob.status === 'NeedsClarification'
                        ? 'More detail needed'
                        : {
                            Queued: 'Waiting to start',
                            Running: 'Creating your preview',
                            Succeeded: 'Your preview is ready',
                            Unsupported: 'This change isn’t available yet',
                            Failed: 'We couldn’t create a preview',
                          }[selectedJob.status]}
                    </strong>
                    <p>
                      {selectedJob.status === 'Failed'
                        ? plannerFailureMessage(selectedJob.resultCode)
                        : ['Queued', 'Running'].includes(selectedJob.status)
                          ? `You can keep browsing your ${noun} while we work.`
                          : selectedJob.message}
                    </p>
                    {selectedJob.status === 'Succeeded' && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await refresh(selectedJob.proposalId);
                            setPreview(true);
                          }, 'Your preview is open.')
                        }
                      >
                        View preview
                      </button>
                    )}
                  </div>
                )}
              </section>
              <details className="manual-options">
                <summary>Prefer to choose the options yourself?</summary>
                <div className="manual-content">
                  <label className="request-label">
                    Change description
                    <textarea
                      value={description}
                      maxLength={4000}
                      rows={2}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  {customOps && (
                    <p className="custom-notice">
                      These are the settings in your draft. Edit them to try a different change.
                    </p>
                  )}
                  <fieldset disabled={busy || !permitted('evolution:request')}>
                    <legend>{pageId === 'customers' ? 'Purchase activity' : 'Order date'}</legend>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={filterEnabled}
                        onChange={(e) => {
                          edit();
                          setFilterEnabled(e.target.checked);
                        }}
                      />
                      {pageId === 'customers'
                        ? 'Show customers who haven’t purchased recently'
                        : 'Show older orders'}
                    </label>
                    <label className="days-label">
                      {pageId === 'customers'
                        ? 'No purchase in the last'
                        : 'Ordered more than this many days ago'}
                      <select
                        value={days}
                        disabled={!filterEnabled}
                        onChange={(e) => {
                          edit();
                          setDays(Number(e.target.value));
                        }}
                      >
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                        <option value={90}>90 days</option>
                        <option value={180}>180 days</option>
                      </select>
                    </label>
                    <p className="field-help">
                      {pageId === 'customers'
                        ? 'Customers with no purchase date won’t appear. '
                        : ''}
                      This demo uses 12 October 2026 as today.
                    </p>
                  </fieldset>
                  <fieldset disabled={busy || !permitted('evolution:request')}>
                    <legend>Columns</legend>
                    <ul className="column-list">
                      {order.map((fieldId, i) => (
                        <li key={fieldId}>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={!hidden.includes(fieldId)}
                              onChange={() => {
                                edit();
                                setHidden((h) =>
                                  h.includes(fieldId)
                                    ? h.filter((id) => id !== fieldId)
                                    : [...h, fieldId],
                                );
                              }}
                            />
                            {page.fields.find((f) => f.id === fieldId)!.label}
                          </label>
                          <div className="move-controls">
                            <button
                              aria-label={`Move ${fieldId} up`}
                              disabled={i === 0}
                              onClick={() => {
                                edit();
                                setOrder((o) => {
                                  const next = [...o];
                                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                                  return next;
                                });
                              }}
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`Move ${fieldId} down`}
                              disabled={i === order.length - 1}
                              onClick={() => {
                                edit();
                                setOrder((o) => {
                                  const next = [...o];
                                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                                  return next;
                                });
                              }}
                            >
                              ↓
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                  <fieldset disabled={busy || !permitted('evolution:request')}>
                    <legend>{numberLabel} display</legend>
                    <label className="days-label">
                      Number style
                      <select
                        aria-label={`${numberLabel} number style`}
                        value={revenueFormat}
                        onChange={(event) => {
                          edit();
                          setRevenueFormat(event.target.value as typeof revenueFormat);
                        }}
                      >
                        <option value="indian">Indian commas · 1,84,000</option>
                        <option value="international">International commas · 184,000</option>
                        <option value="plain">No commas · 184000</option>
                      </select>
                    </label>
                  </fieldset>
                  <fieldset disabled={busy || !permitted('evolution:request')}>
                    <legend>Saved view</legend>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={saved}
                        onChange={(e) => {
                          edit();
                          setSaved(e.target.checked);
                        }}
                      />
                      Include “{viewName}”
                    </label>
                  </fieldset>
                  {actionDraft.length > 0 && (
                    <fieldset disabled={busy || !permitted('evolution:request')}>
                      <legend>Page buttons</legend>
                      {actionDraft.map((action) => (
                        <div key={action.actionId} className="button-options">
                          <label>
                            Button text
                            <input
                              aria-label="Button text"
                              maxLength={120}
                              value={action.label}
                              onChange={(event) => {
                                edit();
                                setActionDraft((values) =>
                                  values.map((value) =>
                                    value.actionId === action.actionId
                                      ? { ...value, label: event.target.value }
                                      : value,
                                  ),
                                );
                              }}
                            />
                          </label>
                          <label>
                            Button position
                            <select
                              aria-label="Button position"
                              value={action.position}
                              onChange={(event) => {
                                edit();
                                setActionDraft((values) =>
                                  values.map((value) =>
                                    value.actionId === action.actionId
                                      ? { ...value, position: event.target.value as ActionPosition }
                                      : value,
                                  ),
                                );
                              }}
                            >
                              {page
                                .actions!.find((value) => value.id === action.actionId)!
                                .allowedPositions.map((position) => (
                                  <option key={position} value={position}>
                                    {
                                      {
                                        page_header: 'Page header',
                                        above_table: 'Above the table',
                                        below_table: 'Below the table',
                                      }[position]
                                    }
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                      ))}
                    </fieldset>
                  )}
                  {page.features?.some((feature) => feature.id === 'customer-followups') && (
                    <fieldset disabled={busy || !permitted('evolution:request')}>
                      <legend>Customer follow-ups</legend>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={followUpsRequested}
                          onChange={(event) => {
                            edit();
                            setFollowUpsRequested(event.target.checked);
                          }}
                        />
                        Enable tasks with an owner, due date, and completion status
                      </label>
                      <p className="field-help">
                        Adds a form and My follow-ups. Turning it off keeps saved tasks for later.
                      </p>
                    </fieldset>
                  )}
                  <button
                    className="primary-button"
                    disabled={
                      busy || !active || !canSave || !!proposal.error || !description.trim()
                    }
                    onClick={() => void saveDraft()}
                  >
                    {revision ? 'Save updated draft' : 'Save my draft'}
                  </button>
                  <button
                    className="secondary-button preview-toggle"
                    onClick={() => setPreview((p) => !p)}
                    disabled={!!proposal.error}
                  >
                    {preview ? 'Close preview' : 'Open preview'}
                  </button>
                  <details className="advanced">
                    <summary>Developer tools</summary>
                    <button className="text-button" onClick={() => setJson((v) => !v)}>
                      {json ? 'Hide configuration' : 'Inspect configuration'}
                    </button>
                    {json && (
                      <pre className="config-json">
                        {JSON.stringify(
                          {
                            operations: proposal.operations,
                            configuration: proposal.configuration,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    )}
                    <p>Paste an operation array. Server validation also runs on save.</p>
                    <textarea
                      aria-label="Custom operation JSON"
                      rows={7}
                      value={manual}
                      onChange={(e) => setManual(e.target.value)}
                    />
                    <button
                      className="secondary-button"
                      disabled={!permitted('evolution:request')}
                      onClick={validateManual}
                    >
                      Validate and preview
                    </button>
                    {manualError && (
                      <p role="alert" className="error-text">
                        {manualError}
                      </p>
                    )}
                  </details>
                </div>
              </details>
            </aside>
          )}
          <div className="table-stack">
            {proposal.error && (
              <div className="validation-error" role="alert">
                <strong>Draft needs a correction</strong>
                <p>{proposal.error}</p>
                <p>Your workspace hasn’t changed.</p>
              </div>
            )}
            {preview && proposal.configuration && (
              <div className="preview-panel">
                <div className="preview-heading">
                  <div>
                    <span className="version-label">
                      Preview only — your workspace hasn’t changed
                    </span>
                    <h2>Here’s how it would look</h2>
                  </div>
                  <span className="preview-count">
                    {matching} matching {noun}
                  </span>
                </div>
                <EvolvePreview pageId={pageId} configuration={proposal.configuration}>
                  <EvolvableTable
                    pageId={pageId}
                    rows={[...rows, ...previewCustomers]}
                    actionHandlers={{ 'open-customer-form': () => setCustomerForm('preview') }}
                    rowKey="id"
                    itemLabel={noun}
                    searchPlaceholder={`Find a ${singular}…`}
                    caption={`Proposed ${noun} table`}
                  />
                  {proposal.configuration.enabledFeatures?.includes('customer-followups') && (
                    <FollowUpsPanel
                      key={revision?.revisionId ?? 'manual-preview'}
                      preview
                      subjectId={session?.principal.subjectId}
                      canManage={session?.principal.subjectId === 'arun'}
                    />
                  )}
                </EvolvePreview>
                <div className="preview-footer">
                  <span>
                    {revision && !dirty
                      ? 'Draft saved. Nothing changes until it’s approved.'
                      : 'Try it out, then save your draft.'}
                  </span>
                </div>
              </div>
            )}
            {revision && (
              <section className="lifecycle-panel">
                <div className="panel-heading">
                  <h2>
                    {revision.state === 'ReadyForPreview' || revision.state === 'PendingApproval'
                      ? 'Happy with the preview?'
                      : 'About this change'}
                  </h2>
                  {revision && <span className="state-badge">{stateLabels[revision.state]}</span>}
                </div>
                {revision ? (
                  <>
                    {revision.state === 'PendingApproval' && (
                      <p className="panel-note">This draft has been sent to Arun for approval.</p>
                    )}
                    {account === 'approver' && revision.state === 'ReadyForPreview' && (
                      <p className="panel-note">
                        Maya hasn’t sent this draft for approval yet. Choose a change marked
                        “Waiting for approval”.
                      </p>
                    )}
                    {revision.state === 'Approved' && (
                      <p className="panel-note">
                        This change is approved and ready to apply to your workspace.
                      </p>
                    )}
                    {dirty && (
                      <p className="field-help">
                        You’ve edited this draft. Save it before sending it for approval.
                      </p>
                    )}
                    {revision.baseGeneration !== active?.generation && (
                      <p className="stale-notice">
                        Your workspace has changed since this draft was made. Start over to use the
                        latest version.
                      </p>
                    )}
                    {((revision.state === 'ReadyForPreview' && permitted('evolution:submit')) ||
                      (revision.state === 'PendingApproval' && permitted('evolution:approve'))) && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          disabled={dirty || !preview}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                        />
                        I’ve checked this preview
                      </label>
                    )}
                    <div className="lifecycle-actions">
                      {permitted('evolution:submit') && revision.state === 'ReadyForPreview' && (
                        <button
                          className="secondary-button"
                          disabled={
                            busy ||
                            !permitted('evolution:submit') ||
                            revision.state !== 'ReadyForPreview' ||
                            dirty ||
                            !acknowledged ||
                            !preview
                          }
                          onClick={() => void review('submit')}
                        >
                          Send for approval
                        </button>
                      )}
                      {permitted('evolution:approve') && revision.state === 'PendingApproval' && (
                        <>
                          <button
                            className="secondary-button"
                            disabled={
                              busy ||
                              !permitted('evolution:approve') ||
                              revision.state !== 'PendingApproval' ||
                              dirty ||
                              !acknowledged ||
                              !preview
                            }
                            onClick={() => void review('approve')}
                          >
                            Approve this change
                          </button>
                          <button
                            className="text-button"
                            disabled={
                              busy ||
                              !permitted('evolution:approve') ||
                              revision.state !== 'PendingApproval'
                            }
                            onClick={() => void review('reject')}
                          >
                            Decline
                          </button>
                        </>
                      )}
                      {permitted('evolution:publish') && revision.state === 'Approved' && (
                        <button
                          className="primary-button"
                          disabled={
                            busy ||
                            !permitted('evolution:publish') ||
                            revision.state !== 'Approved' ||
                            dirty
                          }
                          onClick={() =>
                            void perform(async () => {
                              await api.publish(
                                revision,
                                keyFor('publish', {
                                  id: revision.revisionId,
                                  generation: revision.baseGeneration,
                                }),
                              );
                              await refresh();
                            }, 'Change applied to your workspace.')
                          }
                        >
                          Apply to workspace
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="panel-note">
                    Save a draft as Maya, review its preview, and submit it. Switch to Arun to
                    approve and publish.
                  </p>
                )}
              </section>
            )}

            <details className="current-customers" open={!preview}>
              <summary>Your {noun} now</summary>
              <section className="table-panel" aria-labelledby="active-heading">
                <div className="table-panel-heading">
                  <div>
                    <span className="version-label">Your workspace now</span>
                    <h2 id="active-heading">{title}</h2>
                  </div>
                  <span className="quiet-badge">{active ? 'Current view' : 'Sample view'}</span>
                </div>
                <EvolvableTable
                  pageId={pageId}
                  rows={rows}
                  rowKey="id"
                  itemLabel={noun}
                  searchPlaceholder={`Find a ${singular}…`}
                  caption={`Active ${noun} table`}
                  actionHandlers={{ 'open-customer-form': () => setCustomerForm('active') }}
                />
                {currentConfig.enabledFeatures?.includes('customer-followups') && (
                  <FollowUpsPanel
                    key={active?.generation}
                    subjectId={session?.principal.subjectId}
                    canManage={session?.principal.subjectId === 'arun'}
                  />
                )}
              </section>
            </details>
            <details className="history-panel">
              <summary>Previous changes</summary>
              {proposals.length > 0 && (
                <label className="proposal-selector">
                  Saved drafts
                  <select
                    aria-label="Saved proposal"
                    value={revision?.proposalId ?? ''}
                    disabled={busy}
                    onChange={(e) =>
                      loadRevision(
                        proposals.find((p) => p.proposalId === e.target.value) ?? null,
                        currentConfig,
                      )
                    }
                  >
                    <option value="">Choose a draft</option>
                    {proposals.map((p) => (
                      <option key={p.proposalId} value={p.proposalId}>
                        {p.text.slice(0, 60)} · {stateLabels[p.state]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="panel-heading">
                <h2>Restore an earlier view</h2>
              </div>
              <p className="panel-note">
                You can bring back an earlier view without losing your history.
              </p>
              <ul className="version-list">
                {history.versions.map((v) => (
                  <li key={v.versionId}>
                    <div>
                      <strong>{v.sourceRevisionId ? 'Approved change' : 'Original view'}</strong>
                      <span>Saved by {v.actorId}</span>
                    </div>
                    {v.versionId === active?.versionId ? (
                      <span className="state-badge">Active</span>
                    ) : (
                      <button
                        className="secondary-button"
                        aria-label={`Restore version ${v.configurationHash.slice(0, 12)}`}
                        disabled={busy || !permitted('evolution:rollback')}
                        onClick={() =>
                          void perform(async () => {
                            await api.rollback(
                              v.versionId,
                              active!.generation,
                              keyFor('rollback', {
                                versionId: v.versionId,
                                generation: active!.generation,
                              }),
                            );
                            await refresh();
                          }, 'Your earlier view has been restored.')
                        }
                      >
                        Restore version
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <details>
                <summary>Technical history</summary>
                {revision && (
                  <p className="revision-info">
                    Revision {revision.revisionNumber} · Base generation {revision.baseGeneration} ·
                    Hash <code>{revision.configurationHash}</code>
                  </p>
                )}
                <ul className="activation-list">
                  {history.activations.map((a) => (
                    <li key={a.id}>
                      Generation {a.generation}: {a.kind} · {a.actorId}
                    </li>
                  ))}
                </ul>
              </details>
              {permitted('evolution:audit') && (
                <details
                  onToggle={(e) => {
                    if (e.currentTarget.open)
                      void api
                        .audit()
                        .then(setAudit)
                        .catch((e) => setError(e.message));
                  }}
                >
                  <summary>Audit log</summary>
                  <ul className="activation-list">
                    {audit.map((a) => (
                      <li key={a.id}>
                        {a.eventType} · {a.actorId}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </details>
          </div>
        </div>
        <footer className="page-footer">
          <span>This demo uses sample {noun}.</span>
          <span>Your changes always start with a preview.</span>
        </footer>
      </main>
      {customerForm && (
        <CustomerForm
          preview={customerForm === 'preview'}
          onClose={() => setCustomerForm(null)}
          onSave={(row) => {
            if (customerForm === 'preview') setPreviewCustomers((values) => [...values, row]);
            else {
              const values = [...addedCustomers, row];
              localStorage.setItem(customerStorageKey, JSON.stringify(values));
              setAddedCustomers(values);
            }
          }}
        />
      )}
    </EvolveProvider>
  );
}
