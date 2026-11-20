CREATE OR REPLACE FUNCTION rdps_reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AuditLog_reject_update_delete"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION rdps_reject_audit_log_mutation();

CREATE TRIGGER "AuditLog_reject_truncate"
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT
EXECUTE FUNCTION rdps_reject_audit_log_mutation();
