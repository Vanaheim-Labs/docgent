"use client";

import { useMemo, useState } from "react";
import type { DocSummary } from "@/lib/store";
import { LibraryFilterPanel, type LibraryFilters } from "@/components/LibraryFilterPanel";
import { QueueRow, queueBucket, BUCKET_LABEL, type QueueBucket } from "@/components/QueueRow";
import { UserChip } from "@/components/UserChip";

/**
 * The library, as a work queue.
 *
 * The question this page answers is "what needs my attention", not "show me
 * every document" — so the primary grouping is queue bucket (Needs review /
 * In progress / Done), and brand is a filter rather than the organising
 * axis. The old page grouped by brand because a brand is a real ownership
 * boundary; that is still true, it is just not the question a returning
 * user is asking when they open Studio.
 */
export function LibraryView({
  documents,
  userChip,
  lockedBrand,
}: {
  documents: DocSummary[];
  userChip: React.ReactNode;
  /** Set when this domain is dedicated to one brand — documents are already
   *  filtered to it server-side; this only controls whether the UI still
   *  offers a brand switcher that would be misleading (there is nothing to
   *  switch to on this domain). */
  lockedBrand?: { id: string; name: string } | null;
}) {
  const [filters, setFilters] = useState<LibraryFilters>({
    brands: new Set(),
    statuses: new Set(),
    search: "",
  });

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const bucketFilters = [...filters.statuses]
      .filter((s) => s.startsWith("__bucket:"))
      .map((s) => s.slice("__bucket:".length)) as QueueBucket[];

    return documents.filter((d) => {
      if (filters.brands.size > 0 && !filters.brands.has(d.brand)) return false;
      if (bucketFilters.length > 0 && !bucketFilters.includes(queueBucket(d))) return false;
      if (q) {
        const hay = [d.title, d.frontmatter?.subtitle, d.brandName, d.frontmatter?.doctype]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [documents, filters]);

  const buckets = useMemo(() => {
    const m: Record<QueueBucket, DocSummary[]> = { "needs-review": [], "in-progress": [], done: [] };
    for (const d of filtered) m[queueBucket(d)].push(d);
    // Within a bucket: most recently touched first — that is the ordering a
    // work queue implies, distinct from the index's most-recently-dated
    // ordering used elsewhere.
    for (const b of Object.keys(m) as QueueBucket[]) {
      m[b].sort((a, b2) => (b2.lastCommit?.at ?? b2.dateMs ?? 0) - (a.lastCommit?.at ?? a.dateMs ?? 0));
    }
    return m;
  }, [filtered]);

  const order: QueueBucket[] = ["needs-review", "in-progress", "done"];

  return (
    <div className="shell">
      <LibraryFilterPanel
        documents={documents}
        filters={filters}
        onChange={setFilters}
        lockedBrandName={lockedBrand?.name}
      />
      <div className="main">
        <div className="topbar">
          <div>
            <div className="crumb">
              {filtered.length} of {documents.length} document{documents.length === 1 ? "" : "s"}
            </div>
            <h1 className="doc-title">Documents</h1>
          </div>
          {userChip}
        </div>

        <div className="content">
          {documents.length === 0 && (
            <div className="empty">
              No documents yet. Create one with{" "}
              <code>docforge new --brand &lt;id&gt; --title &quot;...&quot;</code>
            </div>
          )}

          {documents.length > 0 && filtered.length === 0 && (
            <div className="empty">No documents match these filters.</div>
          )}

          {order.map((b) =>
            buckets[b].length > 0 ? (
              <section className="queue-section" key={b}>
                <div className="section-head">
                  <h2 className="section-title">{BUCKET_LABEL[b]}</h2>
                  <span className="section-count">{buckets[b].length}</span>
                </div>
                <div className="queue-list">
                  {buckets[b].map((d) => (
                    <QueueRow key={d.path} doc={d} />
                  ))}
                </div>
              </section>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
