import type { RuntimeOperation, TableConfiguration } from './index';

export type Permission =
  | 'evolution:request'
  | 'evolution:read'
  | 'evolution:refine'
  | 'evolution:submit'
  | 'evolution:approve'
  | 'evolution:publish'
  | 'evolution:rollback'
  | 'evolution:audit'
  | 'followups:read'
  | 'followups:create'
  | 'followups:assign'
  | 'followups:complete';
export interface Scope {
  applicationId: string;
  tenantId: string;
  pageId: string;
}
export interface Principal {
  subjectId: string;
  applicationId: string;
  tenantId: string;
}
export type RevisionState =
  | 'ReadyForPreview'
  | 'PendingApproval'
  | 'Approved'
  | 'Rejected'
  | 'Published'
  | 'Superseded'
  | 'PublicationConflict'
  | 'RolledBack';
export interface ConfigurationEnvelope {
  versionId: string;
  registryVersionId: string;
  schemaVersion: 1;
  configurationHash: string;
  configuration: TableConfiguration;
  generation: number;
}
export interface RevisionEnvelope {
  proposalId: string;
  revisionId: string;
  revisionNumber: number;
  requesterId: string;
  text: string;
  state: RevisionState;
  lockVersion: number;
  baseVersionId: string;
  baseGeneration: number;
  baseConfiguration: TableConfiguration;
  registryVersionId: string;
  configurationHash: string;
  configuration: TableConfiguration;
  operations: RuntimeOperation[];
  createdAt: string;
}
export interface HistoryEntry {
  versionId: string;
  parentVersionId: string | null;
  configurationHash: string;
  sourceRevisionId: string | null;
  createdAt: string;
  actorId: string;
}
export interface ActivationEntry {
  id: string;
  generation: number;
  kind: 'baseline' | 'publish' | 'rollback';
  versionId: string;
  previousVersionId: string | null;
  actorId: string;
  createdAt: string;
}
export interface ConfigurationHistory {
  versions: HistoryEntry[];
  activations: ActivationEntry[];
}
export interface DemoSession {
  principal: Principal;
  permissions: Permission[];
  displayName: string;
}
export type PlannerJobStatus =
  | 'Queued'
  | 'Running'
  | 'Succeeded'
  | 'Unsupported'
  | 'NeedsClarification'
  | 'Failed';
export interface PlannerJobEnvelope {
  jobId: string;
  requestId: string;
  proposalId: string;
  status: PlannerJobStatus;
  attempts: number;
  resultCode: string | null;
  message: string | null;
  revisionId: string | null;
  createdAt: string;
}
