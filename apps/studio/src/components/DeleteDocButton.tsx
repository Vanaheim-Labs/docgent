"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/** Trash can SVG icon */
function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 4h12M5 4V2.5A.5.5 0 0 1 5.5 2h5a.5.5 0 0 1 .5.5V4M6 7v5M10 7v5M3.5 4l.8 9.1a.5.5 0 0 0 .5.4h6.4a.5.5 0 0 0 .5-.4L12.5 4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * DeleteDocButton — renders a trash-icon trigger that opens a confirmation
 * dialog before calling DELETE /api/doc/<brand>/<slug>.
 *
 * Two display variants:
 *   - "icon"   — small icon-only button for use inside list rows (default)
 *   - "button" — full labelled button for use in the document action bar
 *
 * After a successful delete the component either:
 *   - Navigates to `redirectTo` (default: "/") via next/navigation, or
 *   - Calls `onDeleted(slug)` so the parent can remove the row from its
 *     local state without a full page reload (used in the list view).
 *
 * Browser auth: the delete call uses the same session cookie every other
 * Studio fetch uses — no extra Bearer token is required.
 */
export function DeleteDocButton({
  brand,
  slug,
  title,
  variant = "icon",
  redirectTo = "/",
  onDeleted,
}: {
  brand: string;
  slug: string;
  title: string;
  variant?: "icon" | "button";
  /** Where to navigate after deletion (used when there is no onDeleted callback). */
  redirectTo?: string;
  /** If provided, called instead of navigating — parent removes row from list. */
  onDeleted?: (slug: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = useCallback((e: React.MouseEvent) => {
    // Prevent the parent <Link> / row click from firing when the trash is clicked
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setOpen(true);
  }, []);

  const closeDialog = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (deleting) return; // don't close while the request is in flight
    setOpen(false);
    setError(null);
  }, [deleting]);

  const confirmDelete = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc/${brand}/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Delete failed (${res.status})`);
        return;
      }
      setOpen(false);
      if (onDeleted) {
        onDeleted(slug);
      } else {
        router.push(redirectTo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDeleting(false);
    }
  }, [brand, slug, onDeleted, redirectTo, router]);

  return (
    <>
      {/* Trigger */}
      {variant === "icon" ? (
        <button
          type="button"
          className="delete-doc-icon-btn"
          onClick={openDialog}
          title={`Delete "${title}"`}
          aria-label={`Delete document "${title}"`}
        >
          <TrashIcon size={14} />
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-danger"
          onClick={openDialog}
          title={`Delete "${title}"`}
        >
          <TrashIcon size={14} />
          Delete
        </button>
      )}

      {/* Confirmation dialog */}
      {open && (
        <div
          className="delete-doc-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-doc-dialog-title"
          onClick={closeDialog}
        >
          <div
            className="delete-doc-dialog"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <div className="delete-doc-dialog-icon" aria-hidden="true">
              <TrashIcon size={22} />
            </div>
            <h2 id="delete-doc-dialog-title" className="delete-doc-dialog-title">
              Delete document?
            </h2>
            <p className="delete-doc-dialog-body">
              <strong>{title}</strong> will be permanently deleted from the repository. This cannot be undone.
            </p>

            {error && (
              <div className="delete-doc-dialog-error" role="alert">
                {error}
              </div>
            )}

            <div className="delete-doc-dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeDialog}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete document"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
