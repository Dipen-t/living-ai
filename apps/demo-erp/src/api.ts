import type {
  ConfigurationEnvelope,
  ConfigurationHistory,
  DemoSession,
  RevisionEnvelope,
  RuntimeOperation,
  PlannerJobEnvelope,
} from '@evolvekit/core';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => {
    throw new ApiError(
      503,
      'BACKEND_UNAVAILABLE',
      'Backend unavailable. Start the demo API and refresh.',
    );
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.code ?? 'API_ERROR',
      data.message ?? 'Backend unavailable. Start the demo API.',
    );
  return data as T;
}
const actionInput = (revision: RevisionEnvelope) => ({
  revisionId: revision.revisionId,
  configurationHash: revision.configurationHash,
  expectedLockVersion: revision.lockVersion,
});
export function createApi(pageId: string) {
  return {
    planner: () => request<{ mode: string }>(`/v1/planner?pageId=${encodeURIComponent(pageId)}`),
    jobs: () =>
      request<PlannerJobEnvelope[]>(`/v1/planner-jobs?pageId=${encodeURIComponent(pageId)}`),
    job: (id: string) => request<PlannerJobEnvelope>(`/v1/planner-jobs/${id}`),
    generate: (text: string, expectedGeneration: number, key: string) =>
      request<PlannerJobEnvelope>(
        '/v1/evolution-requests',
        { pageId, text, expectedGeneration },
        key,
      ),
    generateRefinement: (revision: RevisionEnvelope, refinement: string, key: string) =>
      request<PlannerJobEnvelope>(
        `/v1/proposals/${revision.proposalId}/revisions`,
        {
          parentRevisionId: revision.revisionId,
          expectedLockVersion: revision.lockVersion,
          refinement,
        },
        key,
      ),
    session: () => request<DemoSession>('/demo/session'),
    signIn: (account: string) => request<DemoSession>('/demo/session', { account }),
    active: () =>
      request<ConfigurationEnvelope>(
        `/v1/configurations/active?pageId=${encodeURIComponent(pageId)}`,
      ),
    proposals: () =>
      request<RevisionEnvelope[]>(`/v1/proposals?pageId=${encodeURIComponent(pageId)}`),
    history: () =>
      request<ConfigurationHistory>(
        `/v1/configurations/history?pageId=${encodeURIComponent(pageId)}`,
      ),
    create: (
      operations: RuntimeOperation[],
      expectedGeneration: number,
      text: string,
      key: string,
    ) =>
      request<RevisionEnvelope>(
        '/v1/evolution-requests',
        { pageId, operations, expectedGeneration, text },
        key,
      ),
    refine: (
      revision: RevisionEnvelope,
      operations: RuntimeOperation[],
      refinement: string,
      key: string,
    ) =>
      request<RevisionEnvelope>(
        `/v1/proposals/${revision.proposalId}/revisions`,
        {
          parentRevisionId: revision.revisionId,
          expectedLockVersion: revision.lockVersion,
          operations,
          refinement,
        },
        key,
      ),
    submit: (revision: RevisionEnvelope) =>
      request<RevisionEnvelope>(`/v1/proposals/${revision.proposalId}/submit`, {
        ...actionInput(revision),
        previewAcknowledged: true,
      }),
    approve: (revision: RevisionEnvelope) =>
      request<RevisionEnvelope>(
        `/v1/proposals/${revision.proposalId}/approve`,
        actionInput(revision),
      ),
    reject: (revision: RevisionEnvelope) =>
      request<RevisionEnvelope>(`/v1/proposals/${revision.proposalId}/reject`, {
        ...actionInput(revision),
        reason: 'Rejected in demo review',
      }),
    publish: (revision: RevisionEnvelope, key: string) =>
      request<ConfigurationEnvelope>(
        '/v1/configurations/publish',
        { revisionId: revision.revisionId, expectedGeneration: revision.baseGeneration },
        key,
      ),
    rollback: (targetVersionId: string, expectedGeneration: number, key: string) =>
      request<ConfigurationEnvelope>(
        '/v1/configurations/rollback',
        {
          pageId,
          targetVersionId,
          expectedGeneration,
          reason: 'Restored from demo history',
        },
        key,
      ),
    audit: () =>
      request<{ id: string; eventType: string; actorId: string; createdAt: string }[]>(
        `/v1/audit-events?pageId=${encodeURIComponent(pageId)}`,
      ),
  };
}
export const api = createApi('customers');
export interface FollowUpTask {
  id: string;
  customerId: string;
  customerName: string;
  company: string;
  title: string;
  ownerId: string;
  dueDate: string;
  status: 'pending' | 'completed';
  version: number;
  createdBy: string;
  completedAt: string | null;
}
export interface FollowUpContext {
  customers: { id: string; name: string; company: string }[];
  owners: { id: string; name: string }[];
  subjectId: string;
  canManage: boolean;
}
export interface FollowUpInput {
  customerId: string;
  title: string;
  ownerId: string;
  dueDate: string;
}
export const followUpsApi = {
  context: () => request<FollowUpContext>('/v1/followups/context'),
  list: () => request<FollowUpTask[]>('/v1/followups'),
  create: (input: FollowUpInput, key: string) => request<FollowUpTask>('/v1/followups', input, key),
  update: (task: FollowUpTask, change: { ownerId?: string; status?: 'pending' | 'completed' }) =>
    request<FollowUpTask>(`/v1/followups/${task.id}`, { ...change, expectedVersion: task.version }),
};
