# Version History API

`GET /api/history/[brand]/[slug]`

Lists the commit history for a single Docgent document. Agents use this to
discover past revisions before diffing or restoring, so they never need to
already know a commit SHA.

---

## Motivation

Before this endpoint existed, agents could read `GET /api/doc/[brand]/[slug]`
for the current HEAD and `GET /api/doc/[brand]/[slug]?ref=<sha>` for a
specific past revision — but had no way to enumerate what revisions were
available. The only reliable workflow was:

1. Human finds a SHA in Studio's timeline and tells the agent.
2. Agent calls `?ref=<sha>`.

This broke Scout and Inky in a live thread when a chart was dropped during a
rewrite: neither agent could find which commit had previously contained it
without a human supplying the SHA.

The history endpoint closes that gap. Agents can now discover the full
timeline autonomously, inspect individual revisions via `?ref=<sha>`, and
restore a chosen revision via `POST /api/restore/[brand]/[slug]` — all
without human assistance.

---

## Request

```
GET /api/history/{brand}/{slug}
Authorization: Bearer <token>
```

### Query parameters

| Parameter | Type    | Default | Max | Description                                   |
|-----------|---------|---------|-----|-----------------------------------------------|
| `limit`   | integer | 20      | 100 | Number of commits to return per page.         |
| `page`    | integer | 1       | —   | 1-based page number for pagination.           |

Pagination is implemented as GitHub API pages (`per_page` + `page`), so
`page=2&limit=20` returns commits 21–40 in reverse-chronological order.

---

## Response

```json
{
  "brand": "acme",
  "slug": "q3-strategy-memo",
  "count": 12,
  "commits": [
    {
      "sha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "shortSha": "a1b2c3d",
      "date": "2026-09-22T01:39:18Z",
      "author": "Scout (agent)",
      "message": "docs(acme/q3-strategy-memo): rewrite via agent API",
      "subject": "docs(acme/q3-strategy-memo): rewrite via agent API",
      "version": "0.4"
    }
  ]
}
```

### Fields

| Field              | Type           | Description                                                                 |
|--------------------|----------------|-----------------------------------------------------------------------------|
| `brand`            | string         | Brand identifier, echoed from the path.                                     |
| `slug`             | string         | Document slug, echoed from the path.                                        |
| `count`            | integer        | Number of commits returned in this response (≤ limit).                     |
| `commits[].sha`    | string         | Full 40-character commit SHA.                                               |
| `commits[].shortSha` | string       | First 7 characters of the SHA — safe for display and log messages.         |
| `commits[].date`   | string (ISO)   | Commit author date in UTC ISO 8601.                                         |
| `commits[].author` | string         | Commit author name (e.g. `"Scout (agent)"` or `"Andrew Julian"`).          |
| `commits[].message`| string         | Full commit message, including trailers.                                    |
| `commits[].subject`| string         | First line of the commit message only — safe for one-line display.         |
| `commits[].version`| string \| null | The `version:` frontmatter field from the document at that commit, or      |
|                    |                | `null` when the field was absent or the blob could not be read.            |

`count` reflects the actual number of entries in `commits`, not the total
history length. To detect the last page, check whether `count < limit`.

---

## Authentication

Same bearer-token check as every other route on this path. The token must be
valid for the requested brand — a token issued for `inkl` cannot enumerate
`northface` history.

```
Authorization: Bearer <brand-scoped-token>
```

Session authentication (Studio users) is also accepted.

---

## Error responses

| Status | Body                                      | Meaning                                         |
|--------|-------------------------------------------|-------------------------------------------------|
| 401    | `"unauthorised"`                          | Missing or invalid token.                       |
| 400    | `{"error": "limit must be 1–100"}`       | `limit` out of range.                           |
| 400    | `{"error": "page must be ≥ 1"}`          | `page` less than 1.                             |
| 404    | `{"error": "..."}`                        | Brand or document not found.                    |
| 500    | `{"error": "..."}`                        | Unexpected error (GitHub API failure, etc.).    |

---

## Typical agent workflows

### Find and restore a dropped chart

```
# 1. Enumerate history
GET /api/history/acme/q3-strategy-memo?limit=30

# 2. Read the suspicious commit to verify the chart is there
GET /api/doc/acme/q3-strategy-memo?ref=<sha>

# 3. Diff it against HEAD to confirm what changed
GET /api/diff/acme/q3-strategy-memo?base=<sha>

# 4. Restore it (forward-revert — a new commit with old content)
POST /api/restore/acme/q3-strategy-memo
{ "ref": "<sha>", "baseSha": "<current-head-sha>" }
```

### Check what version was current last week

```
GET /api/history/acme/q3-strategy-memo?limit=50

# Inspect commits by date, then fetch the content of interest
GET /api/doc/acme/q3-strategy-memo?ref=<sha-from-last-week>
```

---

## Implementation notes

The route lives at:

```
apps/studio/src/app/api/history/[brand]/[slug]/route.ts
```

It delegates to `DocumentStore.timeline()` (which calls `GitStore.history()`
internally), then resolves the frontmatter `version` for each commit by
calling `DocumentStore.readAt()` in parallel. Version resolution is
best-effort: a blob that fails to load yields `version: null` rather than
failing the whole request.

GitHub's commits-by-path API (`GET /repos/{owner}/{repo}/commits?path=...`) is
paginated natively, so `?limit` and `?page` map directly to `per_page` and
`page`. The `count` field in the response is the number of commits actually
returned, not the total history length (GitHub does not expose that without
walking all pages).

---

## Related endpoints

| Endpoint                                       | Purpose                                         |
|------------------------------------------------|-------------------------------------------------|
| `GET /api/doc/[brand]/[slug]`                  | Read current HEAD of a document.               |
| `GET /api/doc/[brand]/[slug]?ref=<sha>`        | Read a document at a specific past commit.     |
| `GET /api/diff/[brand]/[slug]?base=<sha>`      | Diff two commits of a document.                |
| `POST /api/restore/[brand]/[slug]`             | Restore a past revision as a new commit.       |
| `GET /api/docs/[brand]`                        | List all documents in a brand (no history).    |
