-- Snapshot rows and their public change rows are append-only after publication.
-- sourceChangeId remains a provenance value without an FK to mutable internal release data.
ALTER TABLE "PublicSnapshotChange" DROP CONSTRAINT "PublicSnapshotChange_sourceChangeId_fkey";

CREATE FUNCTION "reject_public_snapshot_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Published public snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PublicReleaseSnapshot_immutable"
    BEFORE UPDATE OR DELETE ON "PublicReleaseSnapshot"
    FOR EACH ROW EXECUTE FUNCTION "reject_public_snapshot_mutation"();

CREATE TRIGGER "PublicSnapshotChange_immutable"
    BEFORE UPDATE OR DELETE ON "PublicSnapshotChange"
    FOR EACH ROW EXECUTE FUNCTION "reject_public_snapshot_mutation"();
