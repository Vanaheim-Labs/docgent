#!/usr/bin/env node
/**
 * GitStore tests.
 *
 * Unit tests use a stub fetch so concurrency logic is verified without
 * touching the network. Integration tests run only when DOCFORGE_GH_TOKEN is
 * set, and confine writes to a scratch branch.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { GitStore, StaleWriteError, NotFoundError } from "../src/index.mjs";
import { DocumentStore, parseDocPath, parseFrontmatter } from "../src/documents.mjs";

/* ------------------------------------------------------------------ *
 * Stub helpers
 * ------------------------------------------------------------------ */

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

function stubFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    for (const [pattern, handler] of routes) {
      if (url.includes(pattern) && (!handler.method || handler.method === method)) {
        const r = typeof handler.respond === "function"
          ? handler.respond({ url, method, body: init.body ? JSON.parse(init.body) : null })
          : handler.respond;
        return {
          ok: r.status < 400,
          status: r.status,
          statusText: r.statusText || "",
          headers: new Map([["content-type", "application/json"]]),
          json: async () => r.body,
          text: async () => JSON.stringify(r.body),
        };
      }
    }
    return {
      ok: false, status: 500, statusText: "no stub route",
      headers: new Map([["content-type", "application/json"]]),
      json: async () => ({ message: `no stub for ${method} ${url}` }),
    };
  };
  fn.calls = calls;
  return fn;
}

function makeStore(routes) {
  return new GitStore({
    owner: "o", repo: "r", token: "t",
    fetchImpl: stubFetch(routes),
  });
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

test("readFile decodes content and returns blob sha", async () => {
  const store = makeStore([
    ["/contents/doc.md", { respond: { status: 200, body: {
      type: "file", sha: "blob1", size: 5, content: b64("hello"),
    }}}],
  ]);
  const f = await store.readFile("doc.md");
  assert.equal(f.content, "hello");
  assert.equal(f.sha, "blob1");
});

test("readFile falls back to the blob API for large files", async () => {
  const store = makeStore([
    ["/contents/big.md", { respond: { status: 200, body: {
      type: "file", sha: "blobBig", size: 2_000_000, content: "",
    }}}],
    ["/git/blobs/blobBig", { respond: { status: 200, body: { content: b64("large content") } }}],
  ]);
  const f = await store.readFile("big.md");
  assert.equal(f.content, "large content");
});

test("readFile raises NotFoundError on 404", async () => {
  const store = makeStore([
    ["/contents/missing.md", { respond: { status: 404, body: { message: "Not Found" } }}],
  ]);
  await assert.rejects(() => store.readFile("missing.md"), NotFoundError);
});

test("tree filters by prefix", async () => {
  const store = makeStore([
    ["/git/ref/heads/main", { respond: { status: 200, body: { object: { sha: "head1" } } }}],
    ["/git/trees/head1", { respond: { status: 200, body: { truncated: false, tree: [
      { path: "documents/a/doc.md", type: "blob", sha: "s1", size: 10 },
      { path: "brands/vanaheim/brand.yaml", type: "blob", sha: "s2", size: 20 },
    ]}}}],
  ]);
  const t = await store.tree({ prefix: "documents/" });
  assert.equal(t.entries.length, 1);
  assert.equal(t.entries[0].path, "documents/a/doc.md");
});

/* ------------------------------------------------------------------ *
 * Optimistic concurrency — the point of the whole layer
 * ------------------------------------------------------------------ */

test("writeFile rejects a stale edit rather than clobbering", async () => {
  const store = makeStore([
    ["/contents/doc.md", { method: "GET", respond: { status: 200, body: {
      type: "file", sha: "SERVER_SHA", size: 3, content: b64("new"),
    }}}],
  ]);
  await assert.rejects(
    () => store.writeFile("doc.md", "mine", { message: "m", sha: "MY_STALE_SHA" }),
    (e) => e instanceof StaleWriteError && e.status === 409 && e.expected === "MY_STALE_SHA"
  );
});

test("writeFile rejects an update that supplies no base sha", async () => {
  const store = makeStore([
    ["/contents/doc.md", { method: "GET", respond: { status: 200, body: {
      type: "file", sha: "SERVER_SHA", size: 3, content: b64("old"),
    }}}],
  ]);
  await assert.rejects(
    () => store.writeFile("doc.md", "mine", { message: "m" }),
    StaleWriteError
  );
});

test("writeFile rejects a create that supplies a base sha", async () => {
  const store = makeStore([
    ["/contents/new.md", { method: "GET", respond: { status: 404, body: { message: "Not Found" } }}],
  ]);
  await assert.rejects(
    () => store.writeFile("new.md", "x", { message: "m", sha: "GHOST" }),
    StaleWriteError
  );
});

test("writeFile is a no-op when content is unchanged", async () => {
  const store = makeStore([
    ["/contents/doc.md", { method: "GET", respond: { status: 200, body: {
      type: "file", sha: "same", size: 4, content: b64("same"),
    }}}],
  ]);
  const r = await store.writeFile("doc.md", "same", { message: "m", sha: "same" });
  assert.equal(r.changed, false);
});

test("writeFile commits when the base sha matches", async () => {
  const store = makeStore([
    ["/contents/doc.md", { method: "GET", respond: { status: 200, body: {
      type: "file", sha: "base1", size: 3, content: b64("old"),
    }}}],
    ["/contents/doc.md", { method: "PUT", respond: { status: 200, body: {
      content: { sha: "blob2" },
      commit: { sha: "commit2", html_url: "https://example/commit2" },
    }}}],
  ]);
  const r = await store.writeFile("doc.md", "new", { message: "m", sha: "base1" });
  assert.equal(r.changed, true);
  assert.equal(r.commit.sha, "commit2");
});

test("commitFiles rejects when the branch moved under it", async () => {
  const store = makeStore([
    ["/git/ref/heads/main", { respond: { status: 200, body: { object: { sha: "MOVED" } } }}],
  ]);
  await assert.rejects(
    () => store.commitFiles([{ path: "a.md", content: "x" }], { message: "m", baseSha: "OLD" }),
    StaleWriteError
  );
});

test("commitFiles writes several files as one commit", async () => {
  const store = makeStore([
    ["/git/ref/heads/main", { method: "GET", respond: { status: 200, body: { object: { sha: "head1" } } }}],
    ["/git/commits/head1", { method: "GET", respond: { status: 200, body: { tree: { sha: "tree1" } } }}],
    ["/git/blobs", { method: "POST", respond: { status: 201, body: { sha: "blobN" } }}],
    ["/git/trees", { method: "POST", respond: { status: 201, body: { sha: "tree2" } }}],
    ["/git/commits", { method: "POST", respond: { status: 201, body: { sha: "commitNew" } }}],
    ["/git/refs/heads/main", { method: "PATCH", respond: { status: 200, body: {} }}],
  ]);
  const r = await store.commitFiles(
    [{ path: "doc.md", content: "a" }, { path: "assets/x.svg", content: "b" }],
    { message: "atomic" }
  );
  assert.equal(r.commit.sha, "commitNew");
  assert.equal(r.files.length, 2);
});

/* ------------------------------------------------------------------ *
 * Document layer
 * ------------------------------------------------------------------ */

test("parseDocPath extracts brand and slug", () => {
  assert.deepEqual(
    parseDocPath("documents/vanaheim/q3-review/doc.md"),
    { brand: "vanaheim", slug: "q3-review" }
  );
  assert.equal(parseDocPath("brands/vanaheim/brand.yaml"), null);
});

test("parseFrontmatter reads scalar keys", () => {
  const fm = parseFrontmatter('---\ntitle: "Q3 Review"\nbrand: vanaheim\n---\n# Body\n');
  assert.equal(fm.title, "Q3 Review");
  assert.equal(fm.brand, "vanaheim");
});

test("listDocuments groups docs with their assets", async () => {
  const store = makeStore([
    ["/git/ref/heads/main", { respond: { status: 200, body: { object: { sha: "h" } } }}],
    ["/git/trees/h", { respond: { status: 200, body: { truncated: false, tree: [
      { path: "documents/vanaheim/rep/doc.md", type: "blob", sha: "d1", size: 1 },
      { path: "documents/vanaheim/rep/assets/chart.svg", type: "blob", sha: "a1", size: 2 },
      { path: "documents/inkl/other/doc.md", type: "blob", sha: "d2", size: 1 },
    ]}}}],
  ]);
  const docs = new DocumentStore(store);
  const { documents } = await docs.listDocuments();
  assert.equal(documents.length, 2);
  const rep = documents.find((d) => d.slug === "rep");
  assert.deepEqual(rep.assets, ["assets/chart.svg"]);
});

test("timeline numbers versions oldest-first and flags current", async () => {
  const store = makeStore([
    ["/commits?", { respond: { status: 200, body: [
      { sha: "c3", commit: { message: "third", author: { name: "A", date: "2026-08-03" } } },
      { sha: "c2", commit: { message: "second", author: { name: "A", date: "2026-08-02" } } },
      { sha: "c1", commit: { message: "first", author: { name: "A", date: "2026-08-01" } } },
    ]}}],
  ]);
  const docs = new DocumentStore(store);
  const tl = await docs.timeline("vanaheim", "rep");
  assert.equal(tl[0].version, 3);
  assert.equal(tl[0].isCurrent, true);
  assert.equal(tl[2].version, 1);
});
