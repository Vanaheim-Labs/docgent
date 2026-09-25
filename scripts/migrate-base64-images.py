#!/usr/bin/env python3
"""Migrate base64-embedded images in doc.md files to external images/ files.

Finds all documents containing `data:image/...;base64,...` inline blobs,
extracts them as image files in `documents/<slug>/images/`, and rewrites
the doc.md replacing each blob with `::image{src="images/figure-N.ext"}`.

The migration commits both the extracted image files and the updated doc.md
in a single atomic commit via the GitHub API (commitFiles), so the history
is clean and the repository is always consistent.

Usage:
    python3 scripts/migrate-base64-images.py [--brand <id>] [--dry-run] [--verbose]

Environment:
    DOCGENT_GH_TOKEN   GitHub token (or use GITHUB_TOKEN / gh auth login)
    DOCGENT_GH_TOKEN_<BRAND>  Per-brand token override
    DOCGENT_STUDIO_URL Studio base URL (for display only; migration goes direct to git)

Options:
    --brand <id>   Limit migration to a single brand
    --dry-run      Print what would change without committing
    --verbose      Show full base64 snippet lengths and image paths

Dependencies:
    pip install PyGithub  (or use the git-store package directly)
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path


# Regex matching an inline base64 image anywhere in a line.
# Captures the data URI prefix (group 1) and the base64 payload (group 2).
# We intentionally match the whole `data:image/...;base64,<payload>` token,
# which may appear inside markdown image syntax `![alt](data:image/...)` or
# as a standalone token in a paragraph.
_B64_IMAGE_RE = re.compile(
    r'!\[[^\]]*\]\((data:image/([^;]+);base64,([A-Za-z0-9+/=]+))\)',
    re.MULTILINE,
)

# Also catch bare data URIs not inside markdown image syntax.
_B64_BARE_RE = re.compile(
    r'data:image/([^;]+);base64,([A-Za-z0-9+/=]+)',
    re.MULTILINE,
)

_MIME_TO_EXT = {
    'png': 'png',
    'jpeg': 'jpg',
    'jpg': 'jpg',
    'gif': 'gif',
    'webp': 'webp',
    'svg+xml': 'svg',
}


def find_repo_root() -> Path:
    """Walk up from this script to find the repo root (contains packages/)."""
    here = Path(__file__).parent
    while here != here.parent:
        if (here / "packages").exists() and (here / "brands").exists():
            return here
        here = here.parent
    # Fallback: parent of scripts/
    return Path(__file__).parent.parent


def resolve_token(brand_id: str | None) -> str:
    """Resolve a GitHub token for the given brand (same precedence as CLI)."""
    key = f"DOCGENT_GH_TOKEN_{brand_id.upper()}" if brand_id else None
    if key and os.environ.get(key):
        return os.environ[key]
    if os.environ.get("DOCGENT_GH_TOKEN"):
        return os.environ["DOCGENT_GH_TOKEN"]
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"]
    try:
        t = subprocess.check_output(["gh", "auth", "token"], text=True).strip()
        if t:
            return t
    except Exception:
        pass
    print(f"No GitHub token for brand '{brand_id}'. Set DOCGENT_GH_TOKEN or run 'gh auth login'.", file=sys.stderr)
    sys.exit(2)


def load_brand_repo(root: Path, brand_id: str) -> tuple[str, str]:
    """Return (owner, repo) for the brand's documents repo from brand.yaml."""
    brand_yaml = root / "brands" / brand_id / "brand.yaml"
    if not brand_yaml.exists():
        raise FileNotFoundError(f"brand.yaml not found for brand '{brand_id}'")
    text = brand_yaml.read_text(encoding="utf-8")
    for line in text.splitlines():
        m = re.match(r'\s*repo\s*:\s*["\']?([^"\']+)["\']?\s*$', line)
        if m:
            repo = m.group(1).strip()
            if "/" in repo:
                owner, name = repo.split("/", 1)
                return owner, name
    raise ValueError(f"No 'repo:' found in {brand_yaml}")


def gh_get(owner: str, repo: str, path: str, token: str, ref: str = "main") -> dict:
    """Read a file from GitHub via the Contents API. Returns the JSON response."""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={ref}"
    import urllib.request
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except Exception as e:
        raise RuntimeError(f"GitHub GET {path}: {e}") from e


def gh_tree(owner: str, repo: str, prefix: str, token: str, ref: str = "main") -> list[dict]:
    """List files in a directory tree prefix via the Trees API."""
    # First get the HEAD tree sha, then walk the subtree.
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD?recursive=1&ref={ref}"
    import urllib.request
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        raise RuntimeError(f"GitHub tree listing: {e}") from e
    return [
        item for item in data.get("tree", [])
        if item.get("path", "").startswith(prefix) and item.get("type") == "blob"
    ]


def migrate_doc(
    owner: str,
    repo: str,
    brand: str,
    slug: str,
    token: str,
    dry_run: bool,
    verbose: bool,
) -> bool:
    """Migrate inline base64 images in one document. Returns True if changed."""

    doc_path = f"documents/{slug}/doc.md"
    print(f"\n  {brand}/{slug} ...", end="", flush=True)

    try:
        file_info = gh_get(owner, repo, doc_path, token)
    except RuntimeError as e:
        print(f" [SKIP: {e}]")
        return False

    content_b64 = file_info.get("content", "").replace("\n", "")
    doc_sha = file_info.get("sha")
    markdown = base64.b64decode(content_b64).decode("utf-8")

    if "data:image/" not in markdown:
        print(" (no inline images)")
        return False

    # Extract all inline images and build a replacement map.
    replacements: list[tuple[str, str, bytes, str]] = []  # (match_str, image_filename, image_bytes, ext)
    counter = 0

    def _extract(m: re.Match, alt: str = "") -> str:
        nonlocal counter
        full_match = m.group(0)
        mime_type = m.group(1)  # e.g. 'png', 'jpeg', 'svg+xml'
        payload = m.group(2)    # base64 string

        ext = _MIME_TO_EXT.get(mime_type, mime_type.split("+")[0])
        counter += 1
        img_filename = f"figure-{counter}.{ext}"
        try:
            img_bytes = base64.b64decode(payload)
        except Exception:
            return full_match  # Leave broken blobs alone

        replacements.append((full_match, img_filename, img_bytes, ext))
        shorthand = f'::image{{src="images/{img_filename}"'
        if alt:
            shorthand += f' alt="{alt}"'
        shorthand += '}'
        return shorthand

    # Replace markdown image syntax first: ![alt](data:image/...)
    def _md_repl(m: re.Match) -> str:
        alt_text = m.group(0)[2:m.group(0).index("]")]  # between ![ and ]
        data_uri = m.group(1)
        mime = m.group(2)
        payload = m.group(3)
        fake_match = type("M", (), {"group": lambda self, i: (None, mime, payload)[i]})()
        return _extract(fake_match, alt=alt_text)

    # Manually walk to handle both markdown and bare data URI forms.
    new_markdown = markdown
    seen_uris: set[str] = set()

    for m in _B64_IMAGE_RE.finditer(markdown):
        data_uri = m.group(1)
        if data_uri in seen_uris:
            continue
        seen_uris.add(data_uri)
        alt_text = ""
        # Extract alt between ![ and ]
        raw = m.group(0)
        bracket_end = raw.index("]")
        alt_text = raw[2:bracket_end]

        mime_type = m.group(2)
        payload = m.group(3)
        ext = _MIME_TO_EXT.get(mime_type, mime_type.split("+")[0])
        counter += 1
        img_filename = f"figure-{counter}.{ext}"
        try:
            img_bytes = base64.b64decode(payload)
        except Exception:
            continue

        replacements.append((m.group(0), img_filename, img_bytes, ext))
        shorthand = f'::image{{src="images/{img_filename}"'
        if alt_text:
            shorthand += f' alt="{alt_text}"'
        shorthand += '}'
        new_markdown = new_markdown.replace(m.group(0), shorthand, 1)

    # Now handle any bare data URIs not in markdown image syntax.
    for m in _B64_BARE_RE.finditer(markdown):
        data_uri = "data:image/" + m.group(1) + ";base64," + m.group(2)
        if data_uri in seen_uris:
            continue
        # Skip if already handled as part of a markdown image.
        if any(data_uri in r[0] for r in replacements):
            continue
        seen_uris.add(data_uri)
        mime_type = m.group(1)
        payload = m.group(2)
        ext = _MIME_TO_EXT.get(mime_type, mime_type.split("+")[0])
        counter += 1
        img_filename = f"figure-{counter}.{ext}"
        try:
            img_bytes = base64.b64decode(payload)
        except Exception:
            continue

        replacements.append((m.group(0), img_filename, img_bytes, ext))
        shorthand = f'::image{{src="images/{img_filename}"}}'
        new_markdown = new_markdown.replace(m.group(0), shorthand, 1)

    if not replacements:
        print(" (no extractable inline images)")
        return False

    print(f" {len(replacements)} image(s) to extract")
    for _, img_filename, img_bytes, ext in replacements:
        size_kb = len(img_bytes) / 1024
        if verbose:
            print(f"    {img_filename}  ({size_kb:.1f} KB)")

    if dry_run:
        print("    [DRY RUN — no changes committed]")
        return False

    # Build commitFiles payload: extracted images + updated doc.md.
    import urllib.request

    # Get current HEAD sha for the branch.
    head_url = f"https://api.github.com/repos/{owner}/{repo}/git/refs/heads/main"
    req = urllib.request.Request(head_url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req) as resp:
        head_data = json.loads(resp.read())
    head_sha = head_data["object"]["sha"]

    # Get the current tree sha.
    commit_url = f"https://api.github.com/repos/{owner}/{repo}/git/commits/{head_sha}"
    req = urllib.request.Request(commit_url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req) as resp:
        commit_data = json.loads(resp.read())
    base_tree_sha = commit_data["tree"]["sha"]

    # Create blobs for each image.
    tree_items = []
    for _, img_filename, img_bytes, _ext in replacements:
        blob_url = f"https://api.github.com/repos/{owner}/{repo}/git/blobs"
        blob_body = json.dumps({
            "content": base64.b64encode(img_bytes).decode("ascii"),
            "encoding": "base64",
        }).encode("utf-8")
        req = urllib.request.Request(blob_url, data=blob_body, method="POST", headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with urllib.request.urlopen(req) as resp:
            blob_data = json.loads(resp.read())
        tree_items.append({
            "path": f"documents/{slug}/images/{img_filename}",
            "mode": "100644",
            "type": "blob",
            "sha": blob_data["sha"],
        })

    # Blob for updated doc.md.
    blob_url = f"https://api.github.com/repos/{owner}/{repo}/git/blobs"
    blob_body = json.dumps({
        "content": base64.b64encode(new_markdown.encode("utf-8")).decode("ascii"),
        "encoding": "base64",
    }).encode("utf-8")
    req = urllib.request.Request(blob_url, data=blob_body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req) as resp:
        blob_data = json.loads(resp.read())
    tree_items.append({
        "path": doc_path,
        "mode": "100644",
        "type": "blob",
        "sha": blob_data["sha"],
    })

    # Create tree.
    tree_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees"
    tree_body = json.dumps({
        "base_tree": base_tree_sha,
        "tree": tree_items,
    }).encode("utf-8")
    req = urllib.request.Request(tree_url, data=tree_body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req) as resp:
        tree_data = json.loads(resp.read())
    new_tree_sha = tree_data["sha"]

    # Create commit.
    commit_url2 = f"https://api.github.com/repos/{owner}/{repo}/git/commits"
    commit_body = json.dumps({
        "message": f"docs({brand}/{slug}): extract inline base64 images to images/\n\n"
                   f"Extracted {len(replacements)} image(s) from inline base64 blobs into\n"
                   f"documents/{slug}/images/. References rewritten to ::image{{src=...}} shorthand.",
        "tree": new_tree_sha,
        "parents": [head_sha],
    }).encode("utf-8")
    req = urllib.request.Request(commit_url2, data=commit_body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req) as resp:
        new_commit_data = json.loads(resp.read())
    new_commit_sha = new_commit_data["sha"]

    # Advance HEAD.
    ref_url = f"https://api.github.com/repos/{owner}/{repo}/git/refs/heads/main"
    ref_body = json.dumps({"sha": new_commit_sha}).encode("utf-8")
    req = urllib.request.Request(ref_url, data=ref_body, method="PATCH", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req) as resp:
        pass

    print(f"    committed {new_commit_sha[:7]}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--brand", help="Limit migration to a single brand")
    parser.add_argument("--dry-run", action="store_true", help="Print changes without committing")
    parser.add_argument("--verbose", action="store_true", help="Show image paths and sizes")
    args = parser.parse_args()

    root = find_repo_root()
    brands_dir = root / "brands"

    # Enumerate brands.
    if args.brand:
        brand_ids = [args.brand]
    else:
        brand_ids = sorted(
            d.name for d in brands_dir.iterdir()
            if d.is_dir() and (d / "brand.yaml").exists()
        )

    total_changed = 0
    for brand_id in brand_ids:
        print(f"\n[{brand_id}]")
        try:
            owner, repo = load_brand_repo(root, brand_id)
        except Exception as e:
            print(f"  skipping: {e}")
            continue

        token = resolve_token(brand_id)

        # List all documents for this brand.
        try:
            entries = gh_tree(owner, repo, f"documents/", token)
        except Exception as e:
            print(f"  could not list documents: {e}")
            continue

        # Find unique slugs (documents/<slug>/doc.md).
        slugs: set[str] = set()
        for entry in entries:
            parts = entry["path"].split("/")
            if len(parts) >= 3 and parts[0] == "documents" and parts[2] == "doc.md":
                slugs.add(parts[1])

        if not slugs:
            print("  no documents found")
            continue

        for slug in sorted(slugs):
            changed = migrate_doc(owner, repo, brand_id, slug, token, args.dry_run, args.verbose)
            if changed:
                total_changed += 1

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Migration complete: {total_changed} document(s) updated.")


if __name__ == "__main__":
    main()
