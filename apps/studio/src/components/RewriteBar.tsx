"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ModelOption = { id: string; label: string; provider: "anthropic" | "openai" };

export type RewriteProposal = {
  baseSha: string | null;
  scope: unknown;
  instruction: string;
  model: { id: string; label: string; provider: string };
  span: { start: number; end: number };
  before: string;
  after: string;
  proposed: string;
  diagnostics: { line: number; severity: string; message: string }[];
  valid: boolean;
};

/**
 * The directed-rewrite affordance: select text, say what should happen to it,
 * pick a model, get a proposal back.
 *
 * This component only ever calls the rewrite endpoint and hands the result
 * upward. It does not touch the document buffer and it does not accept
 * anything — Editor owns the buffer, so Editor decides what "accept" means
 * (via the same applyEdit every formatting button already goes through).
 * Keeping the model call and the mutation in different places means undo,
 * dirty-state and preview invalidation stay correct without this component
 * knowing any of that exists.
 */
export function RewriteBar({
  brand,
  slug,
  scopeLabel,
  getScope,
  onProposal,
  onClose,
  anchorTop,
}: {
  brand: string;
  slug: string;
  /** Human label shown in the bar — a heading text, or "selection". */
  scopeLabel: string;
  /** Resolves the scope to send at request time, not at mount time, so a
   *  stale selection is never sent if the author pauses before typing. */
  getScope: () => { kind: "section"; heading: string } | { kind: "range"; start: number; end: number };
  onProposal: (p: RewriteProposal) => void;
  onClose: () => void;
  /** Pixel offset from the top of the source pane, for inline placement. */
  anchorTop: number;
}) {
  const [instruction, setInstruction] = useState("");
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelId, setModelId] = useState<string>("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Models fetched fresh on each open rather than cached at the app shell,
  // so a key added to Vercel mid-session shows up without a redeploy.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rewrite/${brand}/${slug}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Could not load models.");
          setModels([]);
          return;
        }
        setModels(data.models || []);
        setModelId(data.default || data.models?.[0]?.id || "");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setModels([]);
        }
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brand, slug]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const run = useCallback(async () => {
    const text = instruction.trim();
    if (!text || !modelId || busy) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/rewrite/${brand}/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text, model: modelId, scope: getScope() }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Rewrite failed (${res.status}).`);
        return;
      }
      onProposal(data);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [instruction, modelId, busy, brand, slug, getScope, onProposal]);

  const anthropicModels = (models || []).filter((m) => m.provider === "anthropic");
  const openaiModels = (models || []).filter((m) => m.provider === "openai");

  return (
    <div className="rewrite-bar" role="dialog" aria-label="Direct a rewrite">
      <div className="rewrite-bar-row">
        <span className="rewrite-bar-scope" title={scopeLabel}>
          {scopeLabel}
        </span>
        <input
          ref={inputRef}
          className="rewrite-bar-input"
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Tighten this. Lead with the revenue argument. Cut to three paragraphs…"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <select
          className="rewrite-bar-model"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          disabled={busy || loadingModels || (models?.length ?? 0) === 0}
          aria-label="Model"
        >
          {loadingModels && <option value="">Loading models…</option>}
          {!loadingModels && (models?.length ?? 0) === 0 && (
            <option value="">No models configured</option>
          )}
          {anthropicModels.length > 0 && (
            <optgroup label="Anthropic">
              {anthropicModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          )}
          {openaiModels.length > 0 && (
            <optgroup label="OpenAI">
              {openaiModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="btn btn-secondary"
          onClick={onClose}
          disabled={busy}
          title="Close (Esc)"
        >
          Cancel
        </button>
        <button
          className="btn"
          onClick={() => void run()}
          disabled={busy || !instruction.trim() || !modelId}
        >
          {busy ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
      {error && (
        <div className="rewrite-bar-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
