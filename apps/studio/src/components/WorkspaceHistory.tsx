"use client";
import { useState, useRef } from "react";
import { VersionPanel } from "./VersionPanel";
import { DiffView, type DiffResult } from "./DiffView";
import type { TimelineEntry } from "@/lib/store";

export function WorkspaceHistory({ brand, slug, timeline, baseSha, viewingSha, onView }: {
  brand: string; slug: string; timeline: TimelineEntry[]; baseSha?: string;
  viewingSha?: string; onView: (sha?: string) => void;
}) {
  const [comparison, setComparison] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  async function compare(sha: string) {
    const ticket = ++request.current;
    setComparison(sha); setDiff(null); setError(null); setLoading(true);
    try {
      const params = new URLSearchParams({ base: sha });
      const head = viewingSha || timeline[0]?.sha;
      if (head) params.set("head", head);
      const response = await fetch(`/api/diff/${brand}/${slug}?${params}`);
      if (!response.ok) throw new Error("Comparison failed. Try Compare again.");
      const data = await response.json();
      if (ticket === request.current) setDiff(data);
    } catch (e) { if (ticket === request.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (ticket === request.current) setLoading(false); }
  }
  return <>
    <p>Compare shows saved revisions, not unsaved draft changes. Restore is disabled while a draft is unsaved.</p>
    <VersionPanel brand={brand} slug={slug} timeline={timeline} baseSha={baseSha} viewingSha={viewingSha} onView={onView} onCompare={compare} comparingSha={comparison} />
    {comparison && <DiffView baseLabel={comparison.slice(0, 7)} headLabel={viewingSha?.slice(0, 7) || "latest saved"} fileLabel={slug} diff={diff} diffing={loading} error={error} onClose={() => { ++request.current; setComparison(null); }} />}
  </>;
}
