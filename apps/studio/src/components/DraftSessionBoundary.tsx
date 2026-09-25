"use client";
import { useEffect, useState } from "react";
import { installTraversalFallback } from "@/lib/traversal-fallback";

function clearOtherDrafts(owner?: string) {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("docgent.draft:") && (!owner || !key.startsWith(`docgent.draft:${owner}:`))) sessionStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable. */ }
}

/** A recovery buffer belongs to an authenticated identity, never to a URL. */
export function DraftSessionBoundary({ owner, children }: { owner?: string; children: React.ReactNode }) {
  const [expired, setExpired] = useState(false);
  useEffect(installTraversalFallback, []);
  useEffect(() => {
    clearOtherDrafts(owner);
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return; // Network failure is not evidence of logout.
        const session = await response.json();
        if (!controller.signal.aborted && session?.user?.draftOwner !== owner) {
          clearOtherDrafts();
          setExpired(true); // Unmount all private buffers and pending requests.
        }
      } catch { /* Retry on next focus or session notification. */ }
      finally { checking = false; }
    };
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    const signout = (event: Event) => {
      const form = event.target as HTMLFormElement;
      if (form.querySelector('[data-sign-out]')) clearOtherDrafts();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("submit", signout, true);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("authjs") : null;
    if (channel) channel.onmessage = check;
    const timer = window.setInterval(check, 60_000);
    return () => {
      controller.abort(); channel?.close(); clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("submit", signout, true);
    };
  }, [owner]);
  if (expired) return <div role="alert">Your session changed. Private drafts were cleared. <a href="/">Reopen documents</a></div>;
  return children;
}
