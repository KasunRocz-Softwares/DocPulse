-- Keep the denormalized search projection aligned when a release changes projects.
CREATE FUNCTION "rdps_release_document_search_project_sync"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."projectId" IS DISTINCT FROM NEW."projectId" THEN
        UPDATE "ReleaseDocumentSearch"
           SET "projectId" = NEW."projectId",
               "updatedAt" = CURRENT_TIMESTAMP
         WHERE "releaseId" = NEW."id";
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Release_search_document_project_sync"
AFTER UPDATE OF "projectId" ON "Release"
FOR EACH ROW EXECUTE FUNCTION "rdps_release_document_search_project_sync"();
