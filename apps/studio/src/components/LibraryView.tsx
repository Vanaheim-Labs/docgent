"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { DocSummary } from "@/lib/store";

function ForYouCard({ buckets }: { buckets: Record<QueueBucket, DocSummary[]> }) {
  const router = useRouter();
  const reviewCount = buckets["needs-review"].length;
  const inProgressCount = buckets["in-progress"].length;
  const doneCount = buckets["done"].length;
  if (reviewCount + inProgressCount + doneCount === 0) return null;
  return (
    <div className="foryou-card">
      <div className="foryou-card-title">For you</div>
      {reviewCount > 0 && (
        <button className="foryou-row" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: "4px 0", width: "100%", textAlign: "left", fontSize: 13 }} onClick={() => router.push("/?bucket=needs-review")}>
          <span className="foryou-count" data-highlight="true" style={{ fontWeight: 600, flexShrink: 0 }}>{reviewCount}</span>
          <span className="foryou-label">{reviewCount === 1 ? "document needs" : "documents need"} your review</span>
        </button>
      )}
      {inProgressCount > 0 && (
        <button className="foryou-row" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: "4px 0", width: "100%", textAlign: "left", fontSize: 13 }} onClick={() => router.push("/?bucket=in-progress")}>
          <span className="foryou-count" style={{ fontWeight: 600, flexShrink: 0 }}>{inProgressCount}</span>
          <span className="foryou-label">{inProgressCount === 1 ? "document is" : "documents are"} being worked on</span>
        </button>
      )}
      {doneCount > 0 && (
        <button className="foryou-row" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: "4px 0", width: "100%", textAlign: "left", fontSize: 13 }} onClick={() => router.push("/")}>
          <span className="foryou-count" style={{ fontWeight: 600, flexShrink: 0 }}>{doneCount}</span>
          <span className="foryou-label">{doneCount === 1 ? "document" : "documents"} approved or released</span>
        </button>
      )}
    </div>
  );
}
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
}: {
  documents: DocSummary[];
  userChip: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const bucketParam = searchParams?.get("bucket") as QueueBucket | null;

  const [filters, setFilters] = useState<LibraryFilters>({
    brands: new Set(),
    statuses: bucketParam ? new Set([`__bucket:${bucketParam}`]) : new Set(),
    search: "",
  });

  // Sync filter state when URL bucket param changes (sidebar nav clicks).
  useEffect(() => {
    if (bucketParam) {
      setFilters((prev) => ({
        ...prev,
        statuses: new Set([`__bucket:${bucketParam}`]),
      }));
    } else {
      setFilters((prev) => ({
        ...prev,
        statuses: new Set(
          [...prev.statuses].filter((s) => !s.startsWith("__bucket:"))
        ),
      }));
    }
  }, [bucketParam]);

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
  const [doneExpanded, setDoneExpanded] = useState(false);

  return (
    <div className="shell">
      <LibraryFilterPanel
        documents={documents}
        filters={filters}
        onChange={setFilters}
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
              <code>docgent new --brand &lt;id&gt; --title &quot;...&quot;</code>
            </div>
          )}

          {documents.length > 0 && filtered.length === 0 && (
            <div className="empty">No documents match these filters.</div>
          )}

          <div className="queue-table">
            {order.map((b) =>
              buckets[b].length > 0 ? (
                <div className="queue-group" key={b} data-bucket={b}>
                  <div className="queue-group-head">
                    <span className="section-title">{BUCKET_LABEL[b]}</span>
                    <span className="section-count">{buckets[b].length}</span>
                  </div>
                  {b === "done" ? (
                    <>
                      <button
                        className="bucket-toggle"
                        onClick={() => setDoneExpanded((v) => !v)}
                      >
                        {doneExpanded
                          ? "Hide completed ▴"
                          : `Show ${buckets[b].length} completed ▾`}
                      </button>
                      {doneExpanded &&
                        buckets[b].map((d) => <QueueRow key={d.path} doc={d} />)}
                    </>
                  ) : (
                    buckets[b].map((d) => <QueueRow key={d.path} doc={d} />)
                  )}
                </div>
              ) : null
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
