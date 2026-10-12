CREATE TABLE "CodeProposal" (
 "id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
 "requesterId" TEXT NOT NULL, "request" TEXT NOT NULL, "cases" JSONB NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'Queued', "lockVersion" INTEGER NOT NULL DEFAULT 0,
 "baseGeneration" INTEGER NOT NULL, "baseCommit" TEXT NOT NULL,
 "summary" TEXT, "source" JSONB, "contentHash" TEXT, "report" JSONB, "error" TEXT,
 "leaseUntil" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("applicationId","tenantId","id"),
 FOREIGN KEY("applicationId","tenantId") REFERENCES "Tenant"("applicationId","id"),
 CHECK("state" IN ('Queued','Generating','Ready','PendingApproval','Approved','Published','Failed')),
 CHECK("lockVersion">=0 AND "baseGeneration">=0)
);
CREATE INDEX "CodeProposal_applicationId_tenantId_createdAt_idx" ON "CodeProposal"("applicationId","tenantId","createdAt");
CREATE TABLE "CodeApproval" (
 "id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
 "proposalId" TEXT NOT NULL UNIQUE, "contentHash" TEXT NOT NULL, "reviewerId" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("applicationId","tenantId","proposalId") REFERENCES "CodeProposal"("applicationId","tenantId","id")
);
CREATE TABLE "CodeActive" (
 "applicationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "proposalId" TEXT,
 "generation" INTEGER NOT NULL DEFAULT 0 CHECK("generation">=0),
 PRIMARY KEY("applicationId","tenantId"),
 FOREIGN KEY("applicationId","tenantId") REFERENCES "Tenant"("applicationId","id"),
 FOREIGN KEY("applicationId","tenantId","proposalId") REFERENCES "CodeProposal"("applicationId","tenantId","id")
);
CREATE TABLE "CodeRelease" (
 "id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
 "proposalId" TEXT, "previousProposalId" TEXT, "generation" INTEGER NOT NULL,
 "kind" TEXT NOT NULL CHECK("kind" IN ('Activate','Rollback')), "actorId" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("applicationId","tenantId","generation"),
 FOREIGN KEY("applicationId","tenantId","proposalId") REFERENCES "CodeProposal"("applicationId","tenantId","id"),
 FOREIGN KEY("applicationId","tenantId","previousProposalId") REFERENCES "CodeProposal"("applicationId","tenantId","id")
);
CREATE FUNCTION protect_code_source() RETURNS TRIGGER AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Code revisions are immutable'; END IF;
 IF NEW."applicationId" IS DISTINCT FROM OLD."applicationId" OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR
 NEW."requesterId" IS DISTINCT FROM OLD."requesterId" OR NEW."request" IS DISTINCT FROM OLD."request" OR
 NEW."cases" IS DISTINCT FROM OLD."cases" OR NEW."baseCommit" IS DISTINCT FROM OLD."baseCommit" OR
 NEW."baseGeneration" IS DISTINCT FROM OLD."baseGeneration" OR
 (OLD."source" IS NOT NULL AND (NEW."source" IS DISTINCT FROM OLD."source" OR NEW."summary" IS DISTINCT FROM OLD."summary" OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash" OR NEW."report" IS DISTINCT FROM OLD."report"))
 THEN RAISE EXCEPTION 'Code revision content is immutable'; END IF;
 RETURN NEW;
 END; $$ LANGUAGE plpgsql;
CREATE TRIGGER protect_code_source BEFORE UPDATE OR DELETE ON "CodeProposal" FOR EACH ROW EXECUTE FUNCTION protect_code_source();
CREATE FUNCTION protect_code_history() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'Code history is immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER protect_code_approval BEFORE UPDATE OR DELETE ON "CodeApproval" FOR EACH ROW EXECUTE FUNCTION protect_code_history();
CREATE TRIGGER protect_code_release BEFORE UPDATE OR DELETE ON "CodeRelease" FOR EACH ROW EXECUTE FUNCTION protect_code_history();
