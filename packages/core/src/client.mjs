/**
 * DocForge render-worker client.
 *
 * Lets the CLI (and later Studio) render through the container rather than a
 * local WeasyPrint install, so output is identical everywhere.
 */
import fs from "node:fs";
import path from "node:path";

const ASSET_EXT = new Set([
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".otf",
]);

/** Collects a document's local assets as { relPath: base64 }. */
export function collectAssets(docDir, { maxBytes = 15 * 1024 * 1024 } = {}) {
  const assets = {};
  let total = 0;
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "build") continue;
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (ASSET_EXT.has(path.extname(entry.name).toLowerCase())) {
        const buf = fs.readFileSync(abs);
        total += buf.length;
        if (total > maxBytes) {
          throw new Error(`assets exceed ${maxBytes} bytes (at ${rel})`);
        }
        assets[rel] = buf.toString("base64");
      }
    }
  };
  walk(docDir, "");
  return assets;
}

export class RenderClient {
  constructor({ url, key, timeoutMs = 120000 } = {}) {
    this.url = (url || process.env.DOCFORGE_RENDER_URL || "").replace(/\/$/, "");
    this.key = key || process.env.DOCFORGE_API_KEY || "";
    this.timeoutMs = timeoutMs;
    if (!this.url) throw new Error("No render worker URL (set DOCFORGE_RENDER_URL).");
  }

  async health() {
    const res = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(15000) });
    return { status: res.status, body: await res.json() };
  }

  /** Renders markdown to a PDF buffer via the worker. */
  async render({ markdown, brand, assets = {}, filename = "document.pdf" }) {
    const res = await fetch(`${this.url}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DocForge-Key": this.key,
      },
      body: JSON.stringify({ markdown, brand, assets, filename }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        if (j?.error) detail = `${res.status}: ${j.error}`;
      } catch {}
      throw new Error(`render worker rejected the request — ${detail}`);
    }

    return {
      pdf: Buffer.from(await res.arrayBuffer()),
      requestId: res.headers.get("x-docforge-request-id"),
      renderMs: Number(res.headers.get("x-docforge-render-ms")) || null,
    };
  }

  /** Convenience: render a document folder containing doc.md + assets. */
  async renderDocument(mdPath, { brand, filename } = {}) {
    const abs = path.resolve(mdPath);
    const markdown = fs.readFileSync(abs, "utf8");
    const assets = collectAssets(path.dirname(abs));
    return this.render({
      markdown,
      brand,
      assets,
      filename: filename || `${path.basename(abs, ".md")}.pdf`,
    });
  }
}
