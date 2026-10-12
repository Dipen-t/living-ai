CREATE TABLE "PlannerJob" (
  "id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "pageId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL, "proposalId" TEXT NOT NULL, "parentRevisionId" TEXT, "expectedLockVersion" INTEGER,
  "requesterId" TEXT NOT NULL, "correlationId" TEXT NOT NULL, "registryVersionId" TEXT NOT NULL,
  "baseVersionId" TEXT NOT NULL, "baseGeneration" BIGINT NOT NULL, "input" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Queued', "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMPTZ(3), "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resultCode" TEXT, "message" TEXT, "revisionId" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "PlannerJob_revisionId_key" ON "PlannerJob"("revisionId");
CREATE INDEX "PlannerJob_status_availableAt_leaseUntil_idx" ON "PlannerJob"("status","availableAt","leaseUntil");
CREATE INDEX "PlannerJob_applicationId_tenantId_requesterId_createdAt_idx" ON "PlannerJob"("applicationId","tenantId","requesterId","createdAt");
ALTER TABLE "Proposal" ADD CONSTRAINT "proposal_request_pair_unique" UNIQUE ("applicationId","tenantId","pageId","id","requestId");
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_proposal_request_fk" FOREIGN KEY ("applicationId","tenantId","pageId","proposalId","requestId") REFERENCES "Proposal"("applicationId","tenantId","pageId","id","requestId");
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_parent_fk" FOREIGN KEY ("applicationId","tenantId","pageId","proposalId","parentRevisionId") REFERENCES "ProposalRevision"("applicationId","tenantId","pageId","proposalId","id");
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_revision_fk" FOREIGN KEY ("applicationId","tenantId","pageId","proposalId","revisionId") REFERENCES "ProposalRevision"("applicationId","tenantId","pageId","proposalId","id");
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_base_fk" FOREIGN KEY ("applicationId","tenantId","pageId","baseVersionId") REFERENCES "ConfigurationVersion"("applicationId","tenantId","pageId","id");
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_registry_fk" FOREIGN KEY ("applicationId","registryVersionId") REFERENCES "RegistryVersion"("applicationId","id");
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_status_check" CHECK (status IN ('Queued','Running','Succeeded','Unsupported','NeedsClarification','Failed'));
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_attempts_check" CHECK (attempts BETWEEN 0 AND 3);
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_generation_check" CHECK ("baseGeneration" BETWEEN 1 AND 9007199254740991);
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_parent_lock_check" CHECK (("parentRevisionId" IS NULL AND "expectedLockVersion" IS NULL) OR ("parentRevisionId" IS NOT NULL AND "expectedLockVersion">=0));
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_lease_check" CHECK ((status='Running' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR (status<>'Running' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL));
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_completion_check" CHECK ((status IN ('Queued','Running') AND "completedAt" IS NULL AND "revisionId" IS NULL) OR (status='Succeeded' AND "completedAt" IS NOT NULL AND "revisionId" IS NOT NULL) OR (status IN ('Unsupported','NeedsClarification','Failed') AND "completedAt" IS NOT NULL AND "revisionId" IS NULL));
CREATE FUNCTION enforce_planner_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Planner jobs cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (NEW."id",NEW."applicationId",NEW."tenantId",NEW."pageId",NEW."requestId",NEW."proposalId",NEW."parentRevisionId",NEW."expectedLockVersion",NEW."requesterId",NEW."correlationId",NEW."registryVersionId",NEW."baseVersionId",NEW."baseGeneration",NEW."input",NEW."createdAt") IS DISTINCT FROM
     (OLD."id",OLD."applicationId",OLD."tenantId",OLD."pageId",OLD."requestId",OLD."proposalId",OLD."parentRevisionId",OLD."expectedLockVersion",OLD."requesterId",OLD."correlationId",OLD."registryVersionId",OLD."baseVersionId",OLD."baseGeneration",OLD."input",OLD."createdAt") THEN
    RAISE EXCEPTION 'Planner job inputs are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('Succeeded','Unsupported','NeedsClarification','Failed') THEN RAISE EXCEPTION 'Completed planner jobs are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='Running' THEN
    IF NEW.attempts<>OLD.attempts+1 OR (OLD.status='Running' AND OLD."leaseUntil">CURRENT_TIMESTAMP) THEN RAISE EXCEPTION 'Invalid job lease' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='Running' THEN
    IF NEW.attempts<>OLD.attempts THEN RAISE EXCEPTION 'Invalid job attempt count' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Illegal planner job transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planner_job_transition BEFORE UPDATE OR DELETE ON "PlannerJob" FOR EACH ROW EXECUTE FUNCTION enforce_planner_job();
