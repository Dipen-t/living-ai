CREATE TABLE "FollowUpCustomer" (
  "applicationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL, "company" VARCHAR(120) NOT NULL,
  PRIMARY KEY ("applicationId", "tenantId", "id"),
  FOREIGN KEY ("applicationId", "tenantId") REFERENCES "Tenant" ("applicationId", "id") ON DELETE RESTRICT
);
CREATE TABLE "FollowUp" (
  "id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL, "title" VARCHAR(200) NOT NULL, "ownerId" TEXT NOT NULL,
  "dueDate" DATE NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "createdBy" TEXT NOT NULL,
  "completedBy" TEXT, "completedAt" TIMESTAMPTZ(3), "lockVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  FOREIGN KEY ("applicationId", "tenantId", "customerId") REFERENCES "FollowUpCustomer" ("applicationId", "tenantId", "id") ON DELETE RESTRICT,
  CHECK ("status" IN ('pending', 'completed')),
  CHECK (("status" = 'pending' AND "completedAt" IS NULL AND "completedBy" IS NULL) OR ("status" = 'completed' AND "completedAt" IS NOT NULL AND "completedBy" IS NOT NULL)),
  CHECK ("lockVersion" >= 0)
);
CREATE INDEX "FollowUp_applicationId_tenantId_ownerId_status_dueDate_idx" ON "FollowUp" ("applicationId", "tenantId", "ownerId", "status", "dueDate");
