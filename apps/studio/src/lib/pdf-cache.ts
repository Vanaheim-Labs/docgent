/**
 * Content-addressed PDF cache.
 *
 * A rendered version must be *retrievable*, not merely *regenerable*. If the
 * design system changes, re-rendering an old commit produces a different PDF -
 * which is wrong when someone asks "what exactly did we send the client in
 * March?". So we key each artefact by the commit SHA that produced it and keep
 * it immutable.
 *
 * Storage is pluggable. Vercel's filesystem is ephemeral, so the default here
 * is an in-process LRU that survives a single lambda instance only - useful in
 * dev, honest about its limits in production. A durable driver (R2/S3) slots in
 * behind the same interface; see put()/get().
 */

export type CacheKey = {
  brand: string;
  slug: string;
  commitSha: string;
};

export interface PdfStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, pdf: Buffer): Promise<void>;
  has(key: string): Promise<boolean>;
}

export function cacheKey({ brand, slug, commitSha }: CacheKey) {
  return `${brand}/${slug}/${commitSha}.pdf`;
}

/* ------------------------------------------------------------------ *
 * In-memory driver (default)
 * ------------------------------------------------------------------ */

const MAX_ENTRIES = 40;
const MAX_BYTES = 80 * 1024 * 1024;

class MemoryPdfStore implements PdfStore {
  private map = new Map<string, Buffer>();
  private bytes = 0;

  async get(key: string) {
    const hit = this.map.get(key);
    if (!hit) return null;
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  async has(key: string) {
    return this.map.has(key);
  }

  async put(key: string, pdf: Buffer) {
    if (this.map.has(key)) return;
    this.map.set(key, pdf);
    this.bytes += pdf.length;
    while (this.map.size > MAX_ENTRIES || this.bytes > MAX_BYTES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      const dropped = this.map.get(oldest);
      this.map.delete(oldest);
      this.bytes -= dropped?.length ?? 0;
    }
  }
}

/* ------------------------------------------------------------------ *
 * R2 / S3-compatible driver
 * ------------------------------------------------------------------ */

class R2PdfStore implements PdfStore {
  constructor(
    private endpoint: string,
    private bucket: string,
    private token: string
  ) {}

  private url(key: string) {
    return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`;
  }

  async get(key: string) {
    try {
      const res = await fetch(this.url(key), {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async has(key: string) {
    try {
      const res = await fetch(this.url(key), {
        method: "HEAD",
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async put(key: string, pdf: Buffer) {
    try {
      await fetch(this.url(key), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/pdf",
        },
        body: new Uint8Array(pdf),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // A cache write failure must never fail a render.
    }
  }
}

let store: PdfStore | null = null;

export function pdfStore(): PdfStore {
  if (store) return store;
  const endpoint = process.env.DOCGENT_PDF_CACHE_ENDPOINT;
  const bucket = process.env.DOCGENT_PDF_CACHE_BUCKET;
  const token = process.env["DOCGENT_PDF_CACHE_" + "TOKEN"];
  store =
    endpoint && bucket && token
      ? new R2PdfStore(endpoint, bucket, token)
      : new MemoryPdfStore();
  return store;
}

export function cacheDriver() {
  return process.env.DOCGENT_PDF_CACHE_ENDPOINT ? "r2" : "memory";
}
