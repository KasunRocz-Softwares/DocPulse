import { useEffect, useMemo, useState } from "react";
import { adminApi } from "./api";

export type ManagedReleaseChange = {
  id: string;
  title: string;
  category: string;
  internalDescription: string;
  publicDescription?: string | null;
  visibility?: string;
  sortOrder?: number;
};

const categories = [
  "FEATURE",
  "IMPROVEMENT",
  "FIX",
  "BREAKING_CHANGE",
  "SECURITY",
  "PERFORMANCE",
  "DEPRECATION",
  "OTHER",
] as const;

type Props = {
  releaseId: string;
  status: string;
  changes: ManagedReleaseChange[];
  onUpdated: () => Promise<void>;
  onEdit: (change: ManagedReleaseChange) => void;
};

export function ReleaseChangeManagement({
  releaseId,
  status,
  changes,
  onUpdated,
  onEdit,
}: Props) {
  const [items, setItems] = useState(changes);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("ORDER");
  const [groupBy, setGroupBy] = useState("CATEGORY");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkVisibility, setBulkVisibility] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editable = ["DRAFT", "REJECTED"].includes(status.toUpperCase());

  useEffect(() => {
    setItems(changes);
    setSelectedIds([]);
  }, [releaseId, changes]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...items]
      .filter(
        (item) => categoryFilter === "ALL" || item.category === categoryFilter,
      )
      .filter(
        (item) =>
          !normalizedQuery ||
          `${item.title} ${item.internalDescription} ${item.publicDescription ?? ""}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      )
      .sort((left, right) => {
        if (sortBy === "TITLE") return left.title.localeCompare(right.title);
        if (sortBy === "CATEGORY")
          return (
            left.category.localeCompare(right.category) ||
            (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
          );
        if (sortBy === "VISIBILITY")
          return (left.visibility ?? "INTERNAL").localeCompare(
            right.visibility ?? "INTERNAL",
          );
        return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
      });
  }, [items, query, categoryFilter, sortBy]);

  const groups = useMemo(() => {
    if (groupBy === "NONE") return [["All changes", visibleItems]] as const;
    const grouped = new Map<string, ManagedReleaseChange[]>();
    for (const item of visibleItems) {
      const key =
        groupBy === "VISIBILITY"
          ? (item.visibility ?? "INTERNAL")
          : item.category;
      const current = grouped.get(key) ?? [];
      current.push(item);
      grouped.set(key, current);
    }
    return [...grouped.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [visibleItems, groupBy]);

  function toggleVisibleSelection() {
    const visibleIds = visibleItems.map((item) => item.id);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  }

  async function applyBulkEdit() {
    if (!selectedIds.length || (!bulkCategory && !bulkVisibility)) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const updates = items
        .map((item, sortOrder) => ({
          id: item.id,
          sortOrder: item.sortOrder ?? sortOrder,
          ...(selectedIds.includes(item.id) && bulkCategory
            ? { category: bulkCategory }
            : {}),
          ...(selectedIds.includes(item.id) && bulkVisibility
            ? { visibility: bulkVisibility }
            : {}),
        }))
        .filter((item) => selectedIds.includes(item.id));
      const updated = await adminApi.updateChangeOrder<ManagedReleaseChange[]>(
        releaseId,
        updates,
      );
      setItems(updated);
      setSelectedIds([]);
      setBulkCategory("");
      setBulkVisibility("");
      setNotice("Selected changes updated.");
      await onUpdated();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Selected changes could not be updated.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="change-management"
      aria-labelledby="change-management-title"
    >
      <div className="change-management-heading">
        <div>
          <h3 id="change-management-title">Manage structured changes</h3>
          <p>Filter, sort, group, and update selected changes together.</p>
        </div>
        <span>{items.length} changes</span>
      </div>

      <div className="change-management-filters">
        <label>
          Filter changes
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title or description"
          />
        </label>
        <label>
          Category filter
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="ALL">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort changes
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value="ORDER">Release order</option>
            <option value="TITLE">Title</option>
            <option value="CATEGORY">Category</option>
            <option value="VISIBILITY">Visibility</option>
          </select>
        </label>
        <label>
          Group changes
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value)}
          >
            <option value="CATEGORY">Category</option>
            <option value="VISIBILITY">Visibility</option>
            <option value="NONE">No grouping</option>
          </select>
        </label>
      </div>

      {editable ? (
        <div className="change-management-bulk">
          <button
            className="button button-secondary"
            type="button"
            disabled={!visibleItems.length}
            onClick={toggleVisibleSelection}
          >
            {visibleItems.length > 0 &&
            visibleItems.every((item) => selectedIds.includes(item.id))
              ? "Clear visible selection"
              : "Select visible changes"}
          </button>
          <span>{selectedIds.length} selected</span>
          <label>
            Bulk category
            <select
              value={bulkCategory}
              onChange={(event) => setBulkCategory(event.target.value)}
              disabled={!editable || !selectedIds.length}
            >
              <option value="">Keep current category</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bulk visibility
            <select
              value={bulkVisibility}
              onChange={(event) => setBulkVisibility(event.target.value)}
              disabled={!editable || !selectedIds.length}
            >
              <option value="">Keep current visibility</option>
              <option value="INTERNAL">Internal</option>
              <option value="PUBLIC">Public</option>
            </select>
          </label>
          <button
            className="button button-primary"
            type="button"
            disabled={
              !editable ||
              working ||
              !selectedIds.length ||
              (!bulkCategory && !bulkVisibility)
            }
            onClick={() => void applyBulkEdit()}
          >
            {working ? "Saving…" : "Apply to selected"}
          </button>
        </div>
      ) : (
        <p className="workflow-note">
          Changes are read-only in this release state. You can still filter,
          sort, and group them.
        </p>
      )}

      {error && (
        <p className="error-copy" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-copy" role="status">
          {notice}
        </p>
      )}

      {groups.map(([heading, groupItems]) => (
        <section className="change-management-group" key={heading}>
          {groupBy !== "NONE" && <h4>{heading.replaceAll("_", " ")}</h4>}
          <ul className="change-list">
            {groupItems.map((item) => (
              <li key={item.id}>
                <label className="change-management-select">
                  <input
                    type="checkbox"
                    aria-label={`Select change ${item.title}`}
                    checked={selectedIds.includes(item.id)}
                    disabled={!editable}
                    onChange={(event) =>
                      setSelectedIds((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span className="category-tag">
                    {item.category.replaceAll("_", " ").toLowerCase()}
                  </span>
                </label>
                <div>
                  <h4>{item.title}</h4>
                  <p>{item.internalDescription}</p>
                  {item.publicDescription && <p>{item.publicDescription}</p>}
                  <small>{(item.visibility ?? "INTERNAL").toLowerCase()}</small>
                  {editable && (
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => onEdit(item)}
                    >
                      Edit change
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!visibleItems.length && (
        <p className="inline-empty">No changes match these filters.</p>
      )}
    </section>
  );
}
