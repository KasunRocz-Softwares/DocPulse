-- Maintain an indexed, authorization-scoped projection for internal document search.
CREATE TABLE "ReleaseDocumentSearch" (
    "documentId" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "section" VARCHAR(120) NOT NULL,
    "contentText" TEXT NOT NULL,
    "searchVector" TSVECTOR NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ReleaseDocumentSearch_pkey" PRIMARY KEY ("documentId"),
    CONSTRAINT "ReleaseDocumentSearch_documentId_fkey"
        FOREIGN KEY ("documentId") REFERENCES "ReleaseDocument"("id") ON DELETE CASCADE,
    CONSTRAINT "ReleaseDocumentSearch_releaseId_fkey"
        FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE,
    CONSTRAINT "ReleaseDocumentSearch_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
);

CREATE INDEX "ReleaseDocumentSearch_searchVector_gin_idx"
    ON "ReleaseDocumentSearch" USING GIN ("searchVector");
CREATE INDEX "ReleaseDocumentSearch_projectId_updatedAt_idx"
    ON "ReleaseDocumentSearch" ("projectId", "updatedAt" DESC, "documentId");

CREATE FUNCTION "rdps_release_document_json_text"(value JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    child JSONB;
    result TEXT := '';
BEGIN
    CASE jsonb_typeof(value)
        WHEN 'string' THEN RETURN value #>> '{}';
        WHEN 'array' THEN
            FOR child IN
                SELECT element
                  FROM jsonb_array_elements(value) AS elements(element)
            LOOP
                result := result || ' ' || "rdps_release_document_json_text"(child);
            END LOOP;
        WHEN 'object' THEN
            FOR child IN
                SELECT entry_value
                  FROM jsonb_each(value) AS entries(entry_key, entry_value)
            LOOP
                result := result || ' ' || "rdps_release_document_json_text"(child);
            END LOOP;
        ELSE
            RETURN '';
    END CASE;
    RETURN trim(result);
END;
$$;

CREATE FUNCTION "rdps_release_document_search_sync"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_project_id UUID;
    extracted_content TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM "ReleaseDocumentSearch" WHERE "documentId" = OLD."id";
        RETURN OLD;
    END IF;

    SELECT "projectId" INTO target_project_id
      FROM "Release"
     WHERE "id" = NEW."releaseId";

    extracted_content := "rdps_release_document_json_text"(NEW."content");

    INSERT INTO "ReleaseDocumentSearch" (
        "documentId", "releaseId", "projectId", "title", "section",
        "contentText", "searchVector", "updatedAt"
    ) VALUES (
        NEW."id", NEW."releaseId", target_project_id, NEW."title", NEW."section",
        extracted_content,
        setweight(to_tsvector('simple', NEW."title"), 'A') ||
        setweight(to_tsvector('simple', NEW."section"), 'B') ||
        setweight(to_tsvector('simple', extracted_content), 'C'),
        NEW."updatedAt"
    )
    ON CONFLICT ("documentId") DO UPDATE SET
        "releaseId" = EXCLUDED."releaseId",
        "projectId" = EXCLUDED."projectId",
        "title" = EXCLUDED."title",
        "section" = EXCLUDED."section",
        "contentText" = EXCLUDED."contentText",
        "searchVector" = EXCLUDED."searchVector",
        "updatedAt" = EXCLUDED."updatedAt";

    RETURN NEW;
END;
$$;

CREATE TRIGGER "ReleaseDocument_search_sync"
AFTER INSERT OR UPDATE OR DELETE ON "ReleaseDocument"
FOR EACH ROW EXECUTE FUNCTION "rdps_release_document_search_sync"();

-- Backfill existing release documents. The trigger covers writes after this migration.
INSERT INTO "ReleaseDocumentSearch" (
    "documentId", "releaseId", "projectId", "title", "section",
    "contentText", "searchVector", "updatedAt"
)
SELECT
    d."id", d."releaseId", r."projectId", d."title", d."section",
    extracted."contentText",
    setweight(to_tsvector('simple', d."title"), 'A') ||
    setweight(to_tsvector('simple', d."section"), 'B') ||
    setweight(to_tsvector('simple', extracted."contentText"), 'C'),
    d."updatedAt"
FROM "ReleaseDocument" d
JOIN "Release" r ON r."id" = d."releaseId"
CROSS JOIN LATERAL (
    SELECT "rdps_release_document_json_text"(d."content") AS "contentText"
) extracted;
