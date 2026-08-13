"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DocSummary } from "@/lib/store";
import { queueBucket, type QueueBucket } from "@/components/QueueRow";

export type LibraryFilters = {
  brands: Set<string>;
  statuses: Set<string>;
  search: string;
};

/**
 * Filters, not navigation.
 *
 * The old sidebar was a second copy of the document list — every document
 * appeared once in the rail and again in the grid, with the same metadata
 * both times. That duplication is gone: this rail narrows the queue, it does
 * not enumerate it. Brand and status are checkboxes rather than a tree,
 * because narrowing by two independent facets is what a reader actually
 * does ("just Northface" and "just needs review" at once), and a tree only
 * expresses one hierarchy at a time.
 */
export function LibraryFilterPanel({
  documents,
  filters,
  onChange,
  lockedBrandName,
}: {
  documents: DocSummary[];
  filters: LibraryFilters;
  onChange: (next: LibraryFilters) => void;
  /** Set when this domain is dedicated to one brand — the brand facet is
   *  then a fact of the deployment, not something to filter by, so the
   *  picker becomes a plain label instead of a checkbox list. */
  lockedBrandName?: string | null;
}) {
  const brandCounts = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const d of documents) {
      const cur = m.get(d.brand) || { name: d.brandName, count: 0 };
      cur.count++;
      m.set(d.brand, cur);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [documents]);

  const bucketCounts = useMemo(() => {
    const m: Record<QueueBucket, number> = { "needs-review": 0, "in-progress": 0, done: 0 };
    for (const d of documents) m[queueBucket(d)]++;
    return m;
  }, [documents]);

  const toggleBrand = (id: string) => {
    const next = new Set(filters.brands);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ ...filters, brands: next });
  };
  const toggleStatus = (id: string) => {
    const next = new Set(filters.statuses);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ ...filters, statuses: next });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link href="/" className="wordmark" style={{ color: "inherit" }}>
          <span className="wordmark-dot" />
          Docgent
        </Link>
        <div className="wordmark-sub">Studio</div>
      </div>

      <div className="filter-group">
        <input
          className="filter-search"
          type="search"
          placeholder="Search documents…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          aria-label="Search documents"
        />
      </div>

      <div className="filter-group">
        <div className="filter-label">Queue</div>
        {(["needs-review", "in-progress", "done"] as const).map((b) => (
          <button
            key={b}
            className="filter-row"
            data-active={filters.statuses.has(`__bucket:${b}`)}
            onClick={() => toggleStatus(`__bucket:${b}`)}
          >
            <span className={`filter-dot filter-dot-${b}`} aria-hidden="true" />
            <span className="filter-row-name">
              {b === "needs-review" ? "Needs review" : b === "in-progress" ? "In progress" : "Done"}
            </span>
            <span className="filter-row-count">{bucketCounts[b]}</span>
          </button>
        ))}
      </div>

      {lockedBrandName ? (
        <div className="filter-group">
          <div className="filter-label">Brand</div>
          <div className="filter-row" style={{ cursor: "default" }}>
            <span className="filter-row-name">{lockedBrandName}</span>
          </div>
        </div>
      ) : (
        brandCounts.length > 0 && (
          <div className="filter-group">
            <div className="filter-label">Brand</div>
            {brandCounts.map(([id, { name, count }]) => (
              <button
                key={id}
                className="filter-row"
                data-active={filters.brands.has(id)}
                onClick={() => toggleBrand(id)}
              >
                <span className="filter-row-name">{name}</span>
                <span className="filter-row-count">{count}</span>
              </button>
            ))}
          </div>
        )
      )}

      {(filters.brands.size > 0 || filters.statuses.size > 0 || filters.search) && (
        <div className="filter-group">
          <button
            className="btn btn-secondary"
            style={{ width: "100%" }}
            onClick={() => onChange({ brands: new Set(), statuses: new Set(), search: "" })}
          >
            Clear filters
          </button>
        </div>
      )}
    </aside>
  );
}

export function useLibraryFilters(): [LibraryFilters, (f: LibraryFilters) => void] {
  return useState<LibraryFilters>({ brands: new Set(), statuses: new Set(), search: "" }) as [
    LibraryFilters,
    (f: LibraryFilters) => void
  ];
}
