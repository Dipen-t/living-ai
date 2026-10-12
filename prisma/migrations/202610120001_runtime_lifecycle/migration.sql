-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registryVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "applicationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("applicationId","id")
);

-- CreateTable
CREATE TABLE "RegistryVersion" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "installedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionRequest" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalRevision" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "parentRevisionId" TEXT,
    "registryVersionId" TEXT NOT NULL,
    "baseVersionId" TEXT NOT NULL,
    "baseGeneration" BIGINT NOT NULL,
    "operations" JSONB NOT NULL,
    "configuration" JSONB NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "refinementText" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionLifecycle" (
    "revisionId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RevisionLifecycle_pkey" PRIMARY KEY ("revisionId")
);

-- CreateTable
CREATE TABLE "ValidationRun" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "validatorVersion" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigurationVersion" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "registryVersionId" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "sourceRevisionId" TEXT,
    "configuration" JSONB NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigurationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveConfiguration" (
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "generation" BIGINT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ActiveConfiguration_pkey" PRIMARY KEY ("applicationId","tenantId","pageId")
);

-- CreateTable
CREATE TABLE "ActivationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "generation" BIGINT NOT NULL,
    "previousVersionId" TEXT,
    "versionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "approvalId" TEXT,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT,
    "actorId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resourceId" TEXT,
    "correlationId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("applicationId","tenantId","actorId","routeKey","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistryVersion_applicationId_versionLabel_key" ON "RegistryVersion"("applicationId", "versionLabel");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryVersion_applicationId_id_key" ON "RegistryVersion"("applicationId", "id");

-- CreateIndex
CREATE INDEX "EvolutionRequest_applicationId_tenantId_createdAt_idx" ON "EvolutionRequest"("applicationId", "tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionRequest_applicationId_tenantId_pageId_id_key" ON "EvolutionRequest"("applicationId", "tenantId", "pageId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_requestId_key" ON "Proposal"("requestId");

-- CreateIndex
CREATE INDEX "Proposal_applicationId_tenantId_createdAt_idx" ON "Proposal"("applicationId", "tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_applicationId_tenantId_pageId_id_key" ON "Proposal"("applicationId", "tenantId", "pageId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalRevision_proposalId_revisionNumber_key" ON "ProposalRevision"("proposalId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalRevision_applicationId_tenantId_pageId_id_key" ON "ProposalRevision"("applicationId", "tenantId", "pageId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalRevision_applicationId_tenantId_pageId_proposalId_i_key" ON "ProposalRevision"("applicationId", "tenantId", "pageId", "proposalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_revisionId_key" ON "Approval"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_applicationId_tenantId_pageId_id_key" ON "Approval"("applicationId", "tenantId", "pageId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigurationVersion_sourceRevisionId_key" ON "ConfigurationVersion"("sourceRevisionId");

-- CreateIndex
CREATE INDEX "ConfigurationVersion_applicationId_tenantId_pageId_createdA_idx" ON "ConfigurationVersion"("applicationId", "tenantId", "pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigurationVersion_applicationId_tenantId_pageId_id_key" ON "ConfigurationVersion"("applicationId", "tenantId", "pageId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationEvent_applicationId_tenantId_pageId_generation_key" ON "ActivationEvent"("applicationId", "tenantId", "pageId", "generation");

-- CreateIndex
CREATE INDEX "AuditEvent_applicationId_tenantId_createdAt_idx" ON "AuditEvent"("applicationId", "tenantId", "createdAt");
