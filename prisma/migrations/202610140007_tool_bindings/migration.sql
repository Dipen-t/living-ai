ALTER TABLE "CodeProposal" ADD COLUMN "binding" JSONB;
CREATE FUNCTION protect_tool_binding() RETURNS TRIGGER AS $$ BEGIN
 IF NEW."binding" IS DISTINCT FROM OLD."binding" THEN RAISE EXCEPTION 'Tool input binding is immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER protect_tool_binding BEFORE UPDATE ON "CodeProposal" FOR EACH ROW EXECUTE FUNCTION protect_tool_binding();
