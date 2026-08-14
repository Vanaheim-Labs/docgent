/**
 * Docgent git store.
 *
 * Git IS the database. There is no separate CMS store, therefore no sync
 * layer and no reconciliation logic. Agents commit via CLI; humans commit via
 * Studio; both write the same objects to the same history.
 *
 * Backed by the GitHub REST API rather than a local clone, because Studio runs
 * on Vercel where there is no persistent disk.
 *
 * Concurrency model: optimistic. Every write carries the blob SHA the caller
 * based its edit on. If HEAD has moved, the write is rejected with a
 * StaleWriteError rather than silently clobbering. This is the whole reason an
 * agent producing in bulk and a human editing in the UI can share one branch.
 */

export class GitStoreError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = "GitStoreError";
    this.status = status;
    this.cause = cause;
  }
}

/** Raised when a write is based on a revision that is no longer current. */
export class StaleWriteError extends GitStoreError {
  constructor(path, { expected, actual } = {}) {
    super(
      `'${path}' changed since you loaded it. ` +
      `Reload and reapply your edit (expected blob ${expected ?? "?"}, found ${actual ?? "?"}).`
    );
    this.name = "StaleWriteError";
    this.status = 409;
    this.path = path;
    this.expected = expected;
    this.actual = actual;
  }
}

export class NotFoundError extends GitStoreError {
  constructor(what) {
    super(`not found: ${what}`);
    this.name = "NotFoundError";
    this.status = 404;
  }
}

const b64encode = (s) => Buffer.from(s, "utf8").toString("base64");
const b64decode = (s) => Buffer.from(s, "base64").toString("utf8");

export class GitStore {
  /**
   * @param {object} opts
   * @param {string} opts.owner   GitHub org or user
   * @param {string} opts.repo    Repository name
   * @param {string} opts.token   Token with 'repo' scope
   * @param {string} [opts.branch] Default branch to read/write
   */
  constructor({ owner, repo, token, branch = "main", fetchImpl } = {}) {
    if (!owner || !repo) throw new GitStoreError("owner and repo are required");
    if (!token) throw new GitStoreError("a GitHub token is required");
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.branch = branch;
    this.fetch = fetchImpl || globalThis.fetch;
    this.api = "https://api.github.com";
  }

  async #request(pathname, { method = "GET", body, accept } = {}) {
    const url = pathname.startsWith("http")
      ? pathname
      : `${this.api}/repos/${this.owner}/${this.repo}${pathname}`;

    const res = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept || "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 404) throw new NotFoundError(pathname);
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        if (j?.message) detail = `${res.status}: ${j.message}`;
      } catch {}
      throw new GitStoreError(`GitHub API error - ${detail}`, { status: res.status });
    }

    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? res.json() : res.text();
  }

  /* ------------------------------------------------------------------ *
   * Reading
   * ------------------------------------------------------------------ */

  /** Current commit SHA of a branch. */
  async head(branch = this.branch) {
    const ref = await this.#request(`/git/ref/heads/${branch}`);
    return ref.object.sha;
  }

  /**
   * Reads a file. Returns { path, content, sha, size }.
   * `sha` is the blob SHA — pass it back on write for concurrency safety.
   */
  async readFile(path, { ref } = {}) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const data = await this.#request(`/contents/${encodePath(path)}${q}`);
    if (Array.isArray(data)) throw new GitStoreError(`'${path}' is a directory`);
    if (data.type !== "file") throw new GitStoreError(`'${path}' is not a file`);

    // The contents API omits content above ~1MB; fall back to the blob API.
    let content;
    if (data.content) {
      content = b64decode(data.content.replace(/\n/g, ""));
    } else {
      const blob = await this.#request(`/git/blobs/${data.sha}`);
      content = b64decode(blob.content.replace(/\n/g, ""));
    }

    return { path, content, sha: data.sha, size: data.size };
  }

  /**
   * Reads a blob by SHA. Returns its decoded text.
   *
   * A tree listing already carries every blob SHA, so fetching content this
   * way costs one request and no path resolution. It is also immutable: the
   * SHA names that exact content, so the read cannot race a concurrent commit
   * the way a path-and-ref read can.
   */
  async readBlob(sha) {
    const blob = await this.#request(`/git/blobs/${sha}`);
    return b64decode(String(blob.content || "").replace(/\n/g, ""));
  }

  /** Lists a directory. Returns [{ name, path, type, sha, size }]. */
  async listDir(path = "", { ref } = {}) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const data = await this.#request(`/contents/${encodePath(path)}${q}`);
    if (!Array.isArray(data)) throw new GitStoreError(`'${path}' is not a directory`);
    return data.map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type === "dir" ? "dir" : "file",
      sha: e.sha,
      size: e.size,
    }));
  }

  /**
   * Full recursive tree at a ref. One API call rather than N directory walks,
   * which matters when Studio renders a document tree on every page load.
   */
  async tree({ ref, prefix } = {}) {
    const sha = ref || (await this.head());
    const data = await this.#request(`/git/trees/${sha}?recursive=1`);
    let entries = data.tree.map((t) => ({
      path: t.path,
      type: t.type === "tree" ? "dir" : "file",
      sha: t.sha,
      size: t.size,
    }));
    if (prefix) entries = entries.filter((e) => e.path.startsWith(prefix));
    return { sha, truncated: !!data.truncated, entries };
  }

  /* ------------------------------------------------------------------ *
   * Writing
   * ------------------------------------------------------------------ */

  /**
   * Writes a single file as one commit.
   *
   * @param {string} path
   * @param {string} content
   * @param {object} opts
   * @param {string} opts.message  Commit subject
   * @param {string} [opts.sha]    Blob SHA this edit is based on. Required for
   *                               updates; omit only when creating a new file.
   * @param {{name: string, email: string}} [opts.author]
   * @param {string} [opts.branch]
   */
  async writeFile(path, content, { message, sha, author, branch = this.branch } = {}) {
    if (!message) throw new GitStoreError("a commit message is required");

    // Detect staleness before attempting the write so the caller gets a clear
    // 409 rather than GitHub's generic 409 on a mismatched blob.
    let current = null;
    try {
      current = await this.readFile(path, { ref: branch });
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }

    if (current && !sha) {
      throw new StaleWriteError(path, { expected: "(none supplied)", actual: current.sha });
    }
    if (current && sha && current.sha !== sha) {
      throw new StaleWriteError(path, { expected: sha, actual: current.sha });
    }
    if (!current && sha) {
      throw new StaleWriteError(path, { expected: sha, actual: "(file does not exist)" });
    }

    if (current && current.content === content) {
      return { changed: false, commit: null, sha: current.sha, path };
    }

    const body = {
      message,
      content: b64encode(content),
      branch,
      ...(sha ? { sha } : {}),
      ...(author ? { author, committer: author } : {}),
    };

    const res = await this.#request(`/contents/${encodePath(path)}`, {
      method: "PUT",
      body,
    });

    return {
      changed: true,
      path,
      sha: res.content.sha,
      commit: { sha: res.commit.sha, url: res.commit.html_url },
    };
  }

  /**
   * Writes several files as ONE commit, via the low-level git data API.
   *
   * A document edit usually touches doc.md plus assets; committing them
   * separately would produce a history where intermediate commits do not
   * render. Atomic by construction.
   *
   * @param {Array<{path: string, content: string, encoding?: 'utf-8'|'base64'}>} files
   */
  async commitFiles(files, { message, author, branch = this.branch, baseSha } = {}) {
    if (!message) throw new GitStoreError("a commit message is required");
    if (!files?.length) throw new GitStoreError("no files supplied");

    const headSha = await this.head(branch);
    if (baseSha && baseSha !== headSha) {
      throw new StaleWriteError(`branch ${branch}`, { expected: baseSha, actual: headSha });
    }

    const headCommit = await this.#request(`/git/commits/${headSha}`);

    // Blobs first, then a tree referencing them.
    const blobs = await Promise.all(
      files.map(async (f) => {
        const blob = await this.#request("/git/blobs", {
          method: "POST",
          body: {
            content: f.encoding === "base64" ? f.content : b64encode(f.content),
            encoding: "base64",
          },
        });
        return { path: f.path, sha: blob.sha };
      })
    );

    const tree = await this.#request("/git/trees", {
      method: "POST",
      body: {
        base_tree: headCommit.tree.sha,
        tree: blobs.map((b) => ({
          path: b.path,
          mode: "100644",
          type: "blob",
          sha: b.sha,
        })),
      },
    });

    const commit = await this.#request("/git/commits", {
      method: "POST",
      body: {
        message,
        tree: tree.sha,
        parents: [headSha],
        ...(author ? { author, committer: author } : {}),
      },
    });

    await this.#request(`/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    });

    return {
      changed: true,
      commit: { sha: commit.sha, message },
      files: blobs.map((b) => b.path),
    };
  }

  async deleteFile(path, { message, sha, author, branch = this.branch } = {}) {
    if (!message) throw new GitStoreError("a commit message is required");
    const current = await this.readFile(path, { ref: branch });
    if (sha && current.sha !== sha) {
      throw new StaleWriteError(path, { expected: sha, actual: current.sha });
    }
    const res = await this.#request(`/contents/${encodePath(path)}`, {
      method: "DELETE",
      body: { message, sha: current.sha, branch, ...(author ? { author, committer: author } : {}) },
    });
    return { deleted: true, path, commit: { sha: res.commit.sha } };
  }

  /* ------------------------------------------------------------------ *
   * History
   * ------------------------------------------------------------------ */

  /** Commit history for a path. Powers Studio's version timeline. */
  async history(path, { limit = 50, branch = this.branch } = {}) {
    const params = new URLSearchParams({
      path,
      sha: branch,
      per_page: String(Math.min(limit, 100)),
    });
    const commits = await this.#request(`/commits?${params}`);
    return commits.map((c) => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: c.commit.message,
      subject: c.commit.message.split("\n")[0],
      author: {
        name: c.commit.author?.name,
        email: c.commit.author?.email,
        date: c.commit.author?.date,
        login: c.author?.login ?? null,
        avatar: c.author?.avatar_url ?? null,
      },
      url: c.html_url,
    }));
  }

  /** File content at a specific commit — lets Studio show any past version. */
  async readFileAt(path, commitSha) {
    return this.readFile(path, { ref: commitSha });
  }

  /** Raw diff between two commits, optionally narrowed to one path. */
  async diff(baseSha, headSha, { path } = {}) {
    const data = await this.#request(`/compare/${baseSha}...${headSha}`);
    let files = data.files || [];
    if (path) files = files.filter((f) => f.filename === path);
    return {
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
      commits: (data.commits || []).map((c) => ({
        sha: c.sha,
        subject: c.commit.message.split("\n")[0],
      })),
      files: files.map((f) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
    };
  }

  /* ------------------------------------------------------------------ *
   * Branches
   * ------------------------------------------------------------------ */

  async createBranch(name, { from = this.branch } = {}) {
    const sha = await this.head(from);
    await this.#request("/git/refs", {
      method: "POST",
      body: { ref: `refs/heads/${name}`, sha },
    });
    return { branch: name, sha };
  }

  async openPullRequest({ title, body, head, base = this.branch }) {
    const pr = await this.#request("/pulls", {
      method: "POST",
      body: { title, body, head, base },
    });
    return { number: pr.number, url: pr.html_url, state: pr.state };
  }
}

function encodePath(p) {
  return String(p)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}
