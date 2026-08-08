# @docforge/git-store

Git is the database. There is no separate CMS store, therefore no sync layer
and no reconciliation logic. Agents commit via the CLI; humans commit via
Studio; both write the same objects to the same history.

Backed by the GitHub REST API rather than a local clone, because Studio runs
on Vercel where there is no persistent disk.

## Concurrency

Optimistic, and deliberately strict. Every write carries the blob SHA the
caller based its edit on:

- update with a stale SHA -> `StaleWriteError` (409)
- update with no SHA at all -> `StaleWriteError` (a blind write is a bug)
- create with a SHA for a file that does not exist -> `StaleWriteError`
- identical content -> no-op, no empty commit

This is the whole reason an agent producing in bulk and a human editing in
the UI can safely share one branch. A lost update is silent data loss; a 409
is a conversation.

## Atomic multi-file commits

`commitFiles()` uses the low-level git data API (blobs -> tree -> commit -> ref)
so a document edit touching `doc.md` plus assets lands as ONE commit.
Committing those separately would produce intermediate commits that do not
render - a broken version in the timeline.

## API

```js
const git = new GitStore({ owner, repo, token, branch: 'main' });

await git.head()                          // current commit sha
await git.readFile(path, { ref })         // { content, sha, size }
await git.listDir(path, { ref })
await git.tree({ ref, prefix })           // full recursive tree, one call
await git.writeFile(path, content, { message, sha, author })
await git.commitFiles([{path, content}], { message, author, baseSha })
await git.deleteFile(path, { message, sha })
await git.history(path, { limit })        // version timeline
await git.readFileAt(path, commitSha)     // any past version
await git.diff(baseSha, headSha, { path })
await git.createBranch(name, { from })
await git.openPullRequest({ title, body, head, base })
```

### Document layer

`GitStore` knows about files and commits. `DocumentStore` knows about DocForge
documents - where they live, what a version timeline means, and how to commit
an edit with proper attribution.

```js
const docs = new DocumentStore(git);

await docs.listBrands()
await docs.listDocuments({ brand })       // one tree call, assets grouped
await docs.readDocument(brand, slug)      // + parsed frontmatter
await docs.saveDocument(brand, slug, content, { baseSha, author })
await docs.createDocument(brand, slug, content, { author })
await docs.timeline(brand, slug)          // numbered versions, current flagged
await docs.readAt(brand, slug, commitSha)
await docs.diffDocument(brand, slug, baseSha, headSha)
```

## Tests

```bash
node --test packages/git-store/test/git-store.test.mjs
```

Unit tests stub `fetch`, so concurrency semantics are verified without
network access. Integration checks run through the CLI against a scratch
branch (`docforge git-check`).
