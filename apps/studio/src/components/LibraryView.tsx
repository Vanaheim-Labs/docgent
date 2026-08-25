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
import Link from "next/link";
import { LibraryFilterPanel, type LibraryFilters } from "@/components/LibraryFilterPanel";
import { QueueRow, queueBucket, BUCKET_LABEL, type QueueBucket } from "@/components/QueueRow";
import { UserChip } from "@/components/UserChip";

type TimeGroup = "Previous 7 days" | "Previous 30 days" | "Earlier";
type SortMode = "last-modified" | "last-opened" | "title-az";
type ViewMode = "list" | "grid";

function getTimeGroup(ms: number | null | undefined): TimeGroup {
  if (!ms) return "Earlier";
  const diff = Date.now() - ms;
  const days = diff / (1000 * 60 * 60 * 24);
  if (days <= 7) return "Previous 7 days";
  if (days <= 30) return "Previous 30 days";
  return "Earlier";
}

const TIME_GROUP_ORDER: TimeGroup[] = ["Previous 7 days", "Previous 30 days", "Earlier"];

/** Grid view icon SVG */
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
      <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" />
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}

/** List view icon SVG */
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor" />
      <rect x="1" y="7" width="14" height="2" rx="1" fill="currentColor" />
      <rect x="1" y="12" width="14" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

/** Small document icon for grid cards (14px) */
function DocGridIcon() {
  return (
    <svg width="14" height="17" viewBox="0 0 14 17" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 0 H9 L14 5 V15 Q14 17 12 17 H2 Q0 17 0 15 V2 Q0 0 2 0Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1"
      />
      <path d="M9 0 L9 5 H14" fill="none" stroke="var(--accent)" strokeWidth="1" />
    </svg>
  );
}

function relativeDate(ms: number): string {
  const diff = Date.now() - ms;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** One card in the grid view */
function DocGridCard({ doc }: { doc: DocSummary }) {
  const [thumbErrored, setThumbErrored] = useState(false);
  const dateMs = doc.lastCommit?.at ?? doc.dateMs ?? null;
  const dateFmt = dateMs ? relativeDate(dateMs) : null;

  return (
    <Link href={`/${doc.brand}/${doc.slug}`} className="doc-grid-card">
      <div className="doc-grid-thumb">
        {!thumbErrored ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/thumbnail/${doc.brand}/${doc.slug}`}
            alt={`Thumbnail for ${doc.title}`}
            loading="lazy"
            onError={() => setThumbErrored(true)}
          />
        ) : (
          <div className="doc-grid-thumb-placeholder" />
        )}
      </div>
      <div className="doc-grid-info">
        <div className="doc-grid-title-row">
          <DocGridIcon />
          <span className="doc-grid-title" title={doc.title}>{doc.title}</span>
        </div>
        {dateFmt && <span className="doc-grid-date">{dateFmt}</span>}
      </div>
    </Link>
  );
}

/**
 * The library, as a work queue.
 *
 * When no bucket filter is active (home view), documents are grouped by
 * recency (Google Docs-style time grouping) with inline sort/view controls.
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

  const [sortMode, setSortMode] = useState<SortMode>("last-modified");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

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

    let results = documents.filter((d) => {
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

    // Apply sort (for home view controls)
    if (!bucketParam) {
      if (sortMode === "last-modified") {
        results = [...results].sort((a, b) => (b.lastCommit?.at ?? b.dateMs ?? 0) - (a.lastCommit?.at ?? a.dateMs ?? 0));
      } else if (sortMode === "title-az") {
        results = [...results].sort((a, b) => a.title.localeCompare(b.title));
      }
      // "last-opened" — no client-side open tracking yet, fall back to last-modified
    }

    return results;
  }, [documents, filters, sortMode, bucketParam]);

  const buckets = useMemo(() => {
    const m: Record<QueueBucket, DocSummary[]> = { "needs-review": [], "in-progress": [], done: [] };
    for (const d of filtered) m[queueBucket(d)].push(d);
    for (const b of Object.keys(m) as QueueBucket[]) {
      m[b].sort((a, b2) => (b2.lastCommit?.at ?? b2.dateMs ?? 0) - (a.lastCommit?.at ?? a.dateMs ?? 0));
    }
    return m;
  }, [filtered]);

  // Time groups for home view (no bucket filter)
  const timeGroups = useMemo(() => {
    if (bucketParam) return null;
    const m: Record<TimeGroup, DocSummary[]> = {
      "Previous 7 days": [],
      "Previous 30 days": [],
      "Earlier": [],
    };
    for (const d of filtered) {
      const ts = d.lastCommit?.at ?? d.dateMs;
      m[getTimeGroup(ts)].push(d);
    }
    // Already sorted by filtered sort; preserve that order within groups
    return m;
  }, [filtered, bucketParam]);

  const order: QueueBucket[] = ["needs-review", "in-progress", "done"];
  const [doneExpanded, setDoneExpanded] = useState(false);

  return (
    <div className="library-wrap">
      <div className="topbar">
        <div>
          {bucketParam && (
            <div className="crumb">
              {filtered.length} of {documents.length} document{documents.length === 1 ? "" : "s"}
            </div>
          )}
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

        {/* New document strip — shown only on home view */}
        {!bucketParam && (
          <div className="new-doc-strip">
            <div className="new-doc-strip-header">
              <span className="new-doc-strip-title">Start a new document</span>
              <a href="#" className="new-doc-strip-gallery-link">Template gallery →</a>
            </div>
            <div className="new-doc-strip-cards">
              <button
                type="button"
                className="new-doc-card"
                onClick={() => console.log("new document")}
              >
                <span className="new-doc-card-icon">+</span>
                <span className="new-doc-card-label">Blank document</span>
              </button>
            </div>
          </div>
        )}

        {/* Inline controls bar — shown only on home view */}
        {!bucketParam && filtered.length > 0 && (
          <div className="library-controls">
            <span className="library-controls-left">
              {filtered.length} document{filtered.length === 1 ? "" : "s"}
            </span>
            <div className="library-controls-right">
              <select
                className="library-sort-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="last-modified">Last modified</option>
                <option value="last-opened">Last opened</option>
                <option value="title-az">Title A–Z</option>
              </select>
              <button
                type="button"
                className="view-toggle-btn"
                data-active={viewMode === "list" ? "true" : "false"}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                <ListIcon />
              </button>
              <button
                type="button"
                className="view-toggle-btn"
                data-active={viewMode === "grid" ? "true" : "false"}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                <GridIcon />
              </button>
            </div>
          </div>
        )}

        {/* Grid view */}
        {!bucketParam && viewMode === "grid" && timeGroups && (
          <div className="doc-grid">
            {TIME_GROUP_ORDER.map((group) =>
              timeGroups[group].length > 0 ? (
                <div className="doc-grid-group" key={group}>
                  <div className="doc-grid-group-head">{group}</div>
                  <div className="doc-grid-cards">
                    {timeGroups[group].map((d) => (
                      <DocGridCard key={d.path} doc={d} />
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}

        {/* List view */}
        {(bucketParam || viewMode === "list") && (
          <div className="queue-table">
            {bucketParam ? (
              // Bucket filter active: render workflow-bucket groups
              order.map((b) =>
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
                          buckets[b].map((d) => <QueueRow key={d.path} doc={d} showWorkflow />)}
                      </>
                    ) : (
                      buckets[b].map((d) => <QueueRow key={d.path} doc={d} showWorkflow />)
                    )}
                  </div>
                ) : null
              )
            ) : (
              // Home view list: render time-based groups (Google Docs style)
              timeGroups && TIME_GROUP_ORDER.map((group) =>
                timeGroups[group].length > 0 ? (
                  <div className="time-group" key={group}>
                    <div className="time-group-head">{group}</div>
                    {timeGroups[group].map((d) => <QueueRow key={d.path} doc={d} />)}
                  </div>
                ) : null
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
