import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import {
  initialTranslationLocale,
  translationLocales,
} from "./release-localization-model";

type Translation = {
  locale: string;
  title: string;
  summary: string | null;
  changes: Array<{ changeId: string; description: string }>;
};

type EditableRelease = {
  status: string;
  project?: { branding?: { defaultLocale?: string | null } };
  changes: Array<{
    id: string;
    title: string;
    publicDescription: string | null;
    visibility: string;
  }>;
  translations?: Translation[];
};

export function ReleaseLocalizationEditor({
  releaseId,
}: {
  releaseId: string;
}) {
  const [release, setRelease] = useState<EditableRelease | null>(null);
  const [locale, setLocale] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const result = await api.request<EditableRelease>(
      `/internal/releases/${encodeURIComponent(releaseId)}`,
    );
    setRelease(result);
    setLocale(
      (current) =>
        current ||
        initialTranslationLocale(
          result.project?.branding?.defaultLocale ?? "en",
          (result.translations ?? []).map((item) => item.locale),
        ),
    );
  }

  useEffect(() => {
    let active = true;
    api
      .request<EditableRelease>(
        `/internal/releases/${encodeURIComponent(releaseId)}`,
      )
      .then((result) => {
        if (!active) return;
        setRelease(result);
        setLocale((current) =>
          current
            ? current
            : initialTranslationLocale(
                result.project?.branding?.defaultLocale ?? "en",
                (result.translations ?? []).map((item) => item.locale),
              ),
        );
      })
      .catch((requestError: unknown) => {
        if (active)
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not load release translations.",
          );
      });
    return () => {
      active = false;
    };
  }, [releaseId]);

  const translation = useMemo(
    () => release?.translations?.find((item) => item.locale === locale),
    [release, locale],
  );
  const editable =
    release && ["DRAFT", "REJECTED"].includes(release.status.toUpperCase());

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const changes =
      release?.changes
        .filter(
          (change) =>
            change.publicDescription ||
            change.visibility === "PUBLIC_CANDIDATE",
        )
        .map((change) => ({
          changeId: change.id,
          description: String(data.get(`change-${change.id}`) ?? "").trim(),
        }))
        .filter((change) => change.description.length > 0) ?? [];
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.request(
        `/internal/releases/${encodeURIComponent(releaseId)}/translations/${encodeURIComponent(locale)}`,
        {
          method: "PUT",
          body: {
            title: String(data.get("title") ?? "").trim(),
            summary: String(data.get("summary") ?? "").trim() || null,
            changes,
          },
        },
      );
      await load();
      setNotice(
        `Saved the ${locale} translation for the next public approval revision.`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not save the translation.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!release)
    return (
      <section className="section-block" aria-labelledby="localization-heading">
        <h2 id="localization-heading">Localized public release</h2>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="inline-empty" role="status">
            Loading saved release translations…
          </p>
        )}
      </section>
    );
  const publicChanges = release.changes.filter(
    (change) =>
      change.publicDescription || change.visibility === "PUBLIC_CANDIDATE",
  );
  const defaultLocale = release.project?.branding?.defaultLocale ?? "en";
  const locales = translationLocales(
    defaultLocale,
    (release.translations ?? []).map((item) => item.locale),
  );

  return (
    <section className="section-block" aria-labelledby="localization-heading">
      <div className="section-heading">
        <div>
          <h2 id="localization-heading">Localized public release</h2>
          <p>
            Translations are included in the exact public approval revision and
            frozen into its snapshot after approval.
          </p>
          <p className="inline-empty">
            The primary release fields are the {defaultLocale} version. Add
            translations for other locales here.
          </p>
        </div>
      </div>
      {!editable ? (
        <p className="inline-empty">
          Translations are locked after a release enters review or is
          approved/published.
        </p>
      ) : (
        <form
          className="form-panel compact-form"
          onSubmit={(event) => void save(event)}
        >
          <label className="field">
            <span>Locale tag</span>
            <input
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              list={`release-locales-${releaseId}`}
              maxLength={16}
              required
            />
            <datalist id={`release-locales-${releaseId}`}>
              {locales.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Localized release title</span>
            <input
              name="title"
              required
              minLength={2}
              maxLength={200}
              defaultValue={translation?.title ?? ""}
              key={`${locale}-${translation?.title ?? ""}`}
            />
          </label>
          <label className="field">
            <span>Localized public summary</span>
            <textarea
              name="summary"
              maxLength={10000}
              rows={3}
              defaultValue={translation?.summary ?? ""}
              key={`${locale}-summary-${translation?.summary ?? ""}`}
            />
          </label>
          {publicChanges.map((change) => {
            const existing = translation?.changes.find(
              (item) => item.changeId === change.id,
            );
            return (
              <label className="field" key={change.id}>
                <span>{change.title} · localized description</span>
                <textarea
                  name={`change-${change.id}`}
                  maxLength={10000}
                  rows={3}
                  defaultValue={existing?.description ?? ""}
                  key={`${locale}-${change.id}-${existing?.description ?? ""}`}
                />
              </label>
            );
          })}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="form-success" role="status">
              {notice}
            </p>
          )}
          <button className="button button-primary" disabled={saving}>
            {saving ? "Saving translation…" : "Save translation"}
          </button>
        </form>
      )}
    </section>
  );
}
