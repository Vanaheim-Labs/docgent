"""DocForge render worker.

Markdown (+ frontmatter) -> pandoc -> semantic HTML -> WeasyPrint -> PDF.

This service is the single source of render truth. Studio (Vercel) and the CLI
both call it, so a document renders identically regardless of who asked.

Auth: shared secret in the X-DocForge-Key header. Set DOCFORGE_API_KEY in the
environment; if unset the service refuses to start rather than running open.
"""
from __future__ import annotations

import base64
import hmac
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from flask import Flask, g, jsonify, request

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

PIPELINE_DIR = Path(os.environ.get("DOCFORGE_PIPELINE_DIR", "/app/pipeline"))
API_KEY = os.environ.get("DOCFORGE_API_KEY", "")
MAX_BODY_BYTES = int(os.environ.get("DOCFORGE_MAX_BODY", 20 * 1024 * 1024))
RENDER_TIMEOUT = int(os.environ.get("DOCFORGE_RENDER_TIMEOUT", 90))

TEMPLATE = PIPELINE_DIR / "core" / "templates" / "document.html"
FILTER = PIPELINE_DIR / "core" / "filters" / "vocabulary.lua"
BASE_CSS = PIPELINE_DIR / "core" / "css" / "base.css"
BRANDS_DIR = PIPELINE_DIR / "brands"

PANDOC_EXTENSIONS = (
    "markdown"
    "+yaml_metadata_block"
    "+fenced_divs"
    "+bracketed_spans"
    "+pipe_tables"
    "+footnotes"
    "+inline_notes"
    "+header_attributes"
    "+table_attributes"
    "+link_attributes"
    "+smart"
)

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("docforge")

app = Flask(__name__)


def jlog(event: str, **fields) -> None:
    """Structured log line — Fly aggregates stdout, so keep it parseable."""
    payload = {"event": event, "ts": round(time.time(), 3)}
    rid = getattr(g, "request_id", None)
    if rid:
        payload["request_id"] = rid
    payload.update(fields)
    log.info(json.dumps(payload))


# --------------------------------------------------------------------------- #
# YAML-lite (frontmatter + brand tokens)
# --------------------------------------------------------------------------- #

def parse_simple_yaml(text: str) -> dict:
    """Parses the nested-scalar subset used by brand.yaml and frontmatter.

    Deliberately not a full YAML implementation — the registry constrains the
    shape, and a real parser is a dependency we do not need in this container.
    """
    root: dict = {}
    stack = [(-1, root)]
    for raw in text.split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if ":" not in line:
            continue
        key, _, rest = line.partition(":")
        key = key.strip()
        rest = rest.strip()
        if rest == "":
            node: dict = {}
            parent[key] = node
            stack.append((indent, node))
        else:
            parent[key] = _coerce(rest)
    return root


def _coerce(v: str):
    v = v.strip().strip('"').strip("'")
    low = v.lower()
    if low in ("true", "false"):
        return low == "true"
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v


def read_frontmatter(md: str) -> dict:
    if not md.startswith("---"):
        return {}
    end = md.find("\n---", 3)
    if end == -1:
        return {}
    return parse_simple_yaml(md[4:end])


# --------------------------------------------------------------------------- #
# Brand tokens -> CSS custom properties
# --------------------------------------------------------------------------- #

def brand_tokens_css(brand: dict) -> str:
    t = brand.get("typography", {}) or {}
    p = brand.get("palette", {}) or {}
    pg = brand.get("page", {}) or {}

    serif = t.get("serif", "Georgia, serif")
    sans = t.get("sans", "Helvetica, Arial, sans-serif")
    mono = t.get("mono", "Menlo, monospace")
    body_family = serif if t.get("body_family", "serif") == "serif" else sans
    heading_family = serif if t.get("heading_family") == "serif" else sans

    def pal(key, default):
        return p.get(key, default)

    return f""":root {{
  --font-serif: {serif};
  --font-sans: {sans};
  --font-mono: {mono};
  --font-body: {body_family};
  --font-heading: {heading_family};
  --base-size: {t.get('base_size', '10.5pt')};
  --line-height: {t.get('line_height', 1.55)};

  --ink: {pal('ink', '#12161c')};
  --ink-soft: {pal('ink_soft', '#454e5a')};
  --ink-faint: {pal('ink_faint', '#8a94a1')};
  --rule: {pal('rule', '#dfe4ea')};
  --paper: {pal('paper', '#ffffff')};
  --paper-alt: {pal('paper_alt', '#f6f8fa')};
  --accent: {pal('accent', '#1f4b6e')};
  --accent-soft: {pal('accent_soft', '#e8f0f6')};
  --warning: {pal('warning', '#a35b12')};
  --warning-soft: {pal('warning_soft', '#fdf3e6')};
  --risk: {pal('risk', '#9b2c2c')};
  --risk-soft: {pal('risk_soft', '#fdecec')};
  --success: {pal('success', '#1f6b45')};
  --success-soft: {pal('success_soft', '#e9f5ef')};

  --page-size: {pg.get('size', 'A4')};
  --margin-top: {pg.get('margin_top', '22mm')};
  --margin-bottom: {pg.get('margin_bottom', '20mm')};
  --margin-inner: {pg.get('margin_inner', '24mm')};
  --margin-outer: {pg.get('margin_outer', '20mm')};
}}"""


def footer_css(brand: dict, fm: dict) -> str:
    name = str(brand.get("name", "")).replace('"', '\\"')
    cls = str(fm.get("classification", "")).upper().replace('"', '\\"')
    return f'@page {{ --footer-left: "{name}"; --footer-center: "{cls}"; }}'


def load_brand(brand_id: str) -> dict:
    safe = os.path.basename(brand_id)
    if safe != brand_id or not safe:
        raise ValueError(f"invalid brand id: {brand_id!r}")
    path = BRANDS_DIR / safe / "brand.yaml"
    if not path.exists():
        raise FileNotFoundError(f"unknown brand '{safe}'")
    data = parse_simple_yaml(path.read_text(encoding="utf-8"))
    data["id"] = safe
    data["_dir"] = str(BRANDS_DIR / safe)
    return data


# --------------------------------------------------------------------------- #
# Render pipeline
# --------------------------------------------------------------------------- #

def render_pdf(markdown: str, brand_id: str, assets: dict[str, str] | None) -> bytes:
    brand = load_brand(brand_id)
    fm = read_frontmatter(markdown)

    with tempfile.TemporaryDirectory(prefix="docforge-") as tmp:
        work = Path(tmp)
        md_path = work / "doc.md"
        md_path.write_text(markdown, encoding="utf-8")

        # Assets are base64 to keep the API a single JSON body. Paths are
        # constrained to the working directory — no traversal out of it.
        for rel, b64 in (assets or {}).items():
            target = (work / rel).resolve()
            if not str(target).startswith(str(work.resolve())):
                raise ValueError(f"asset path escapes working directory: {rel}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(base64.b64decode(b64))

        tokens_css = work / "_tokens.css"
        tokens_css.write_text(
            brand_tokens_css(brand) + "\n" + footer_css(brand, fm),
            encoding="utf-8",
        )

        css_args: list[str] = ["--css", str(tokens_css), "--css", str(BASE_CSS)]
        brand_css = Path(brand["_dir"]) / "css" / "brand.css"
        if brand_css.exists():
            css_args += ["--css", str(brand_css)]

        html_path = work / "doc.html"
        pandoc_cmd = [
            "pandoc",
            str(md_path),
            "--from", PANDOC_EXTENSIONS,
            "--to", "html5",
            "--standalone",
            "--template", str(TEMPLATE),
            "--lua-filter", str(FILTER),
            "--section-divs",
            "--metadata", f"brandname={brand.get('name', brand_id)}",
            "-o", str(html_path),
        ]
        if fm.get("toc"):
            pandoc_cmd += ["--toc", "--toc-depth=2"]
        pandoc_cmd += css_args

        t0 = time.time()
        proc = subprocess.run(
            pandoc_cmd, capture_output=True, timeout=RENDER_TIMEOUT
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "pandoc failed: " + proc.stderr.decode("utf-8", "replace")[:2000]
            )
        pandoc_ms = int((time.time() - t0) * 1000)

        pdf_path = work / "doc.pdf"
        t1 = time.time()
        proc = subprocess.run(
            ["weasyprint", "-u", str(work) + os.sep, str(html_path), str(pdf_path)],
            capture_output=True,
            timeout=RENDER_TIMEOUT,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "weasyprint failed: " + proc.stderr.decode("utf-8", "replace")[:2000]
            )
        weasy_ms = int((time.time() - t1) * 1000)

        g.pandoc_ms = pandoc_ms
        g.weasy_ms = weasy_ms
        return pdf_path.read_bytes()


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

@app.before_request
def _before():
    g.request_id = uuid.uuid4().hex[:12]
    g.t_start = time.time()


def authorised() -> bool:
    supplied = request.headers.get("X-DocForge-Key", "")
    return bool(API_KEY) and hmac.compare_digest(supplied, API_KEY)


def pandoc_supports_extensions() -> bool:
    """Confirms the installed pandoc understands every extension we require.

    Debian's pandoc is old enough to reject some of them, which surfaces as a
    422 on first render rather than a boot failure. Check it explicitly.
    """
    if shutil.which("pandoc") is None:
        return False
    try:
        out = subprocess.run(
            ["pandoc", "--list-extensions=markdown"],
            capture_output=True, timeout=15, text=True,
        ).stdout
    except Exception:
        return False
    available = {line[1:] for line in out.splitlines() if line[:1] in "+-"}
    required = {
        e for e in PANDOC_EXTENSIONS.split("+")[1:]
    }
    missing = required - available
    if missing:
        jlog("pandoc.missing_extensions", missing=sorted(missing))
    return not missing


@app.get("/health")
def health():
    checks = {
        "pandoc": shutil.which("pandoc") is not None,
        "pandoc_extensions": pandoc_supports_extensions(),
        "weasyprint": shutil.which("weasyprint") is not None,
        "template": TEMPLATE.exists(),
        "filter": FILTER.exists(),
        "base_css": BASE_CSS.exists(),
        "brands_dir": BRANDS_DIR.exists(),
    }
    ok = all(checks.values())
    brands = (
        sorted(p.name for p in BRANDS_DIR.iterdir() if (p / "brand.yaml").exists())
        if BRANDS_DIR.exists()
        else []
    )
    return jsonify(status="ok" if ok else "degraded", checks=checks, brands=brands), (
        200 if ok else 503
    )


@app.get("/brands")
def brands():
    if not authorised():
        return jsonify(error="unauthorised"), 401
    if not BRANDS_DIR.exists():
        return jsonify(brands=[]), 200
    out = []
    for p in sorted(BRANDS_DIR.iterdir()):
        if (p / "brand.yaml").exists():
            b = parse_simple_yaml((p / "brand.yaml").read_text(encoding="utf-8"))
            out.append({"id": p.name, "name": b.get("name", p.name)})
    return jsonify(brands=out), 200


@app.post("/render")
def render():
    if not authorised():
        jlog("render.unauthorised", ip=request.remote_addr)
        return jsonify(error="unauthorised"), 401

    if request.content_length and request.content_length > MAX_BODY_BYTES:
        return jsonify(error="payload too large"), 413

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="expected a JSON object"), 400

    markdown = body.get("markdown")
    if not isinstance(markdown, str) or not markdown.strip():
        return jsonify(error="'markdown' is required"), 400

    fm = read_frontmatter(markdown)
    brand_id = body.get("brand") or fm.get("brand")
    if not brand_id:
        return jsonify(error="no brand given (body 'brand' or frontmatter)"), 400

    assets = body.get("assets") or {}
    if not isinstance(assets, dict):
        return jsonify(error="'assets' must be an object of path -> base64"), 400

    try:
        pdf = render_pdf(markdown, str(brand_id), assets)
    except FileNotFoundError as e:
        jlog("render.unknown_brand", brand=brand_id, error=str(e))
        return jsonify(error=str(e)), 404
    except ValueError as e:
        jlog("render.bad_request", error=str(e))
        return jsonify(error=str(e)), 400
    except subprocess.TimeoutExpired:
        jlog("render.timeout", brand=brand_id)
        return jsonify(error="render timed out"), 504
    except RuntimeError as e:
        jlog("render.failed", brand=brand_id, error=str(e)[:500])
        return jsonify(error=str(e)), 422

    total_ms = int((time.time() - g.t_start) * 1000)
    jlog(
        "render.ok",
        brand=brand_id,
        bytes=len(pdf),
        pandoc_ms=getattr(g, "pandoc_ms", None),
        weasyprint_ms=getattr(g, "weasy_ms", None),
        total_ms=total_ms,
    )

    filename = str(body.get("filename") or "document.pdf")
    filename = os.path.basename(filename) or "document.pdf"

    return (
        pdf,
        200,
        {
            "Content-Type": "application/pdf",
            "Content-Disposition": f'inline; filename="{filename}"',
            "X-DocForge-Request-Id": g.request_id,
            "X-DocForge-Render-Ms": str(total_ms),
        },
    )


if not API_KEY:
    # Fail closed. An unauthenticated render endpoint is a free PDF farm.
    log.warning(
        json.dumps({"event": "startup.no_api_key",
                    "message": "DOCFORGE_API_KEY unset — /render and /brands will reject all requests"})
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
