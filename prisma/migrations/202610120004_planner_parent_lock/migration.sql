-- PostgreSQL CHECK accepts NULL; explicitly require a lock version for refinement jobs.
ALTER TABLE "PlannerJob" DROP CONSTRAINT "job_parent_lock_check";
ALTER TABLE "PlannerJob" ADD CONSTRAINT "job_parent_lock_check" CHECK (
  ("parentRevisionId" IS NULL AND "expectedLockVersion" IS NULL) OR
  ("parentRevisionId" IS NOT NULL AND "expectedLockVersion" IS NOT NULL AND "expectedLockVersion">=0)
);
