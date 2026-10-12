-- Composite references make guessed IDs insufficient to cross application/tenant/page boundaries.
ALTER TABLE "RegistryVersion" ADD CONSTRAINT "registry_application_fk" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Application" ADD CONSTRAINT "application_registry_fk" FOREIGN KEY ("id", "registryVersionId") REFERENCES "RegistryVersion"("applicationId", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Tenant" ADD CONSTRAINT "tenant_application_fk" FOREIGN KEY ("applicationId") REFERENCES "Application"("id");

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['EvolutionRequest','Proposal','ProposalRevision','RevisionLifecycle','ValidationRun','Approval','ConfigurationVersion','ActiveConfiguration','ActivationEvent','AuditEvent','IdempotencyKey'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("applicationId", "tenantId") REFERENCES "Tenant"("applicationId", "id")', tbl, tbl || '_tenant_fk');
  END LOOP;
END $$;

ALTER TABLE "Proposal" ADD CONSTRAINT "proposal_request_fk" FOREIGN KEY ("applicationId","tenantId","pageId","requestId") REFERENCES "EvolutionRequest"("applicationId","tenantId","pageId","id");
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "revision_proposal_fk" FOREIGN KEY ("applicationId","tenantId","pageId","proposalId") REFERENCES "Proposal"("applicationId","tenantId","pageId","id");
ALTER TABLE "Proposal" ADD CONSTRAINT "proposal_current_fk" FOREIGN KEY ("applicationId","tenantId","pageId","id","currentRevisionId") REFERENCES "ProposalRevision"("applicationId","tenantId","pageId","proposalId","id");
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "revision_parent_fk" FOREIGN KEY ("applicationId","tenantId","pageId","proposalId","parentRevisionId") REFERENCES "ProposalRevision"("applicationId","tenantId","pageId","proposalId","id");
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "revision_base_fk" FOREIGN KEY ("applicationId","tenantId","pageId","baseVersionId") REFERENCES "ConfigurationVersion"("applicationId","tenantId","pageId","id");
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "revision_hash_unique" UNIQUE ("applicationId","tenantId","pageId","id","configurationHash");
ALTER TABLE "Approval" ADD CONSTRAINT "approval_revision_hash_fk" FOREIGN KEY ("applicationId","tenantId","pageId","revisionId","configurationHash") REFERENCES "ProposalRevision"("applicationId","tenantId","pageId","id","configurationHash");
ALTER TABLE "ConfigurationVersion" ADD CONSTRAINT "version_parent_fk" FOREIGN KEY ("applicationId","tenantId","pageId","parentVersionId") REFERENCES "ConfigurationVersion"("applicationId","tenantId","pageId","id");
ALTER TABLE "ConfigurationVersion" ADD CONSTRAINT "version_revision_fk" FOREIGN KEY ("applicationId","tenantId","pageId","sourceRevisionId") REFERENCES "ProposalRevision"("applicationId","tenantId","pageId","id");

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['ProposalRevision','ConfigurationVersion'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("applicationId","registryVersionId") REFERENCES "RegistryVersion"("applicationId","id")', tbl, tbl || '_registry_fk');
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY['RevisionLifecycle','ValidationRun'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("applicationId","tenantId","pageId","revisionId") REFERENCES "ProposalRevision"("applicationId","tenantId","pageId","id")', tbl, tbl || '_revision_fk');
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY['ActiveConfiguration','ActivationEvent'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("applicationId","tenantId","pageId","versionId") REFERENCES "ConfigurationVersion"("applicationId","tenantId","pageId","id")', tbl, tbl || '_version_fk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (generation BETWEEN 1 AND 9007199254740991)', tbl, tbl || '_generation_check');
  END LOOP;
END $$;

ALTER TABLE "ActivationEvent" ADD CONSTRAINT "activation_previous_fk" FOREIGN KEY ("applicationId","tenantId","pageId","previousVersionId") REFERENCES "ConfigurationVersion"("applicationId","tenantId","pageId","id");
ALTER TABLE "ActivationEvent" ADD CONSTRAINT "activation_approval_fk" FOREIGN KEY ("applicationId","tenantId","pageId","approvalId") REFERENCES "Approval"("applicationId","tenantId","pageId","id");
ALTER TABLE "ActivationEvent" ADD CONSTRAINT "activation_kind_check" CHECK (kind IN ('baseline','publish','rollback'));
ALTER TABLE "ActivationEvent" ADD CONSTRAINT "activation_approval_check" CHECK ((kind='publish' AND "approvalId" IS NOT NULL) OR (kind<>'publish' AND "approvalId" IS NULL));
ALTER TABLE "Approval" ADD CONSTRAINT "approval_decision_check" CHECK (decision IN ('approve','reject'));
ALTER TABLE "RevisionLifecycle" ADD CONSTRAINT "lifecycle_state_check" CHECK (state IN ('ReadyForPreview','PendingApproval','Approved','Rejected','Published','Superseded','PublicationConflict','RolledBack'));
ALTER TABLE "RevisionLifecycle" ADD CONSTRAINT "lifecycle_lock_check" CHECK ("lockVersion">=0);
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "revision_number_check" CHECK ("revisionNumber">0 AND "baseGeneration">=1);

CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME USING ERRCODE='23514';
END $$;
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['EvolutionRequest','RegistryVersion','ProposalRevision','ValidationRun','Approval','ConfigurationVersion','ActivationEvent','AuditEvent'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()', tbl);
  END LOOP;
END $$;

CREATE FUNCTION enforce_lifecycle_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW."lockVersion" <> OLD."lockVersion" + 1 THEN RAISE EXCEPTION 'Expected a lifecycle lock increment' USING ERRCODE='23514'; END IF;
  IF NOT (
    (OLD.state='ReadyForPreview' AND NEW.state IN ('PendingApproval','Superseded')) OR
    (OLD.state='PendingApproval' AND NEW.state IN ('Approved','Rejected','Superseded')) OR
    (OLD.state='Approved' AND NEW.state IN ('Published','PublicationConflict','Superseded')) OR
    (OLD.state='Published' AND NEW.state='RolledBack')
  ) THEN RAISE EXCEPTION 'Illegal lifecycle transition % -> %', OLD.state, NEW.state USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_transition BEFORE UPDATE ON "RevisionLifecycle" FOR EACH ROW EXECUTE FUNCTION enforce_lifecycle_transition();
