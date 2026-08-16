/**
 * Calls the Phase 2 render worker.
 *
 * Studio never renders locally — Vercel cannot run WeasyPrint. Going through
 * the worker also guarantees the PDF a human previews is byte-identical to the
 * one an agent produces from the CLI.
 */
export type RenderResult = {
  pdf: Buffer;
  renderMs: number | null;
  requestId: string | null;
};

export async function renderMarkdown(
  markdown: string,
  brand: string,
  assets: Record<string, string> = {}
): Promise<RenderResult> {
  const url = process.env.DOCGENT_RENDER_URL;
  const key = process.env.DOCGENT_API_KEY;
  if (!url) throw new Error("DOCGENT_RENDER_URL is not set");
  if (!key) throw new Error("DOCGENT_API_KEY is not set");

  const res = await fetch(`${url.replace(/\/$/, "")}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Docgent-Key": key,
    },
    body: JSON.stringify({ markdown, brand, assets }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) detail = j.error;
    } catch {}
    throw new Error(`render failed — ${detail}`);
  }

  return {
    pdf: Buffer.from(await res.arrayBuffer()),
    renderMs: Number(res.headers.get("x-docgent-render-ms")) || null,
    requestId: res.headers.get("x-docgent-request-id"),
  };
}

export type RenderHtmlResult = {
  html: string;
  renderMs: number | null;
};

/**
 * Renders to HTML for the editor preview pane.
 *
 * Same worker, same pandoc stage the PDF is built from — the HTML is the
 * intermediate artifact, not a second styling path, so the preview cannot
 * drift from the printed document's content.
 */
export async function renderMarkdownHtml(
  markdown: string,
  brand: string,
  assets: Record<string, string> = {}
): Promise<RenderHtmlResult> {
  const url = process.env.DOCGENT_RENDER_URL;
  const key = process.env.DOCGENT_API_KEY;
  if (!url) throw new Error("DOCGENT_RENDER_URL is not set");
  if (!key) throw new Error("DOCGENT_API_KEY is not set");

  const res = await fetch(`${url.replace(/\/$/, "")}/render/html`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Docgent-Key": key,
    },
    body: JSON.stringify({ markdown, brand, assets }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) detail = j.error;
    } catch {}
    throw new Error(`html render failed — ${detail}`);
  }

  return {
    html: await res.text(),
    renderMs: Number(res.headers.get("x-docgent-render-ms")) || null,
  };
}

export type ThumbnailResult = {
  png: Buffer;
  renderMs: number | null;
};

/**
 * Renders page 1 of a document to a PNG thumbnail, for the version filmstrip.
 *
 * Calls the worker's own PDF pipeline (not a lighter approximation) so the
 * thumbnail is pixel-true to the artefact it represents.
 */
export async function renderThumbnail(
  markdown: string,
  brand: string,
  assets: Record<string, string> = {}
): Promise<ThumbnailResult> {
  const url = process.env.DOCGENT_RENDER_URL;
  const key = process.env.DOCGENT_API_KEY;
  if (!url) throw new Error("DOCGENT_RENDER_URL is not set");
  if (!key) throw new Error("DOCGENT_API_KEY is not set");

  const res = await fetch(`${url.replace(/\/$/, "")}/thumbnail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Docgent-Key": key,
    },
    body: JSON.stringify({ markdown, brand, assets }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) detail = j.error;
    } catch {}
    throw new Error(`thumbnail failed — ${detail}`);
  }

  return {
    png: Buffer.from(await res.arrayBuffer()),
    renderMs: Number(res.headers.get("x-docgent-render-ms")) || null,
  };
}

/** Fetches a document's assets from git as base64, for the render call. */
export async function collectAssetsFromGit(
  git: any,
  dir: string,
  assetPaths: string[],
  ref?: string
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    assetPaths.map(async (rel) => {
      const full = `${dir}/${rel}`;
      try {
        const file = await git.readFile(full, { ref });
        out[rel] = Buffer.from(file.content, "utf8").toString("base64");
      } catch {
        // A missing asset should not block the whole render; the PDF will
        // show a broken image, which is a clearer signal than a 500.
      }
    })
  );
  return out;
}
