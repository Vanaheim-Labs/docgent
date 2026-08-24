"""Docgent render worker.

Markdown (+ frontmatter) -> pandoc -> semantic HTML -> WeasyPrint -> PDF.

This service is the single source of render truth. Studio (Vercel) and the CLI
both call it, so a document renders identically regardless of who asked.

Auth: shared secret in the X-DocForge-Key header (rename to X-Docgent-Key is
pending a coordinated Fly+Studio deploy). Set DOCFORGE_API_KEY in the
environment; if unset the service refuses to start rather than running open.
"""
from __future__ import annotations

import base64
import hmac
import json
import logging
import mimetypes
import os
import re
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

# DOCGENT_* is current; DOCFORGE_* is accepted as a fallback so a partial
# rollout of fly.toml/secrets doesn't lock the service into an empty
# API_KEY (this exact gap is what caused render/thumbnail 401s despite a
# correctly-set DOCGENT_API_KEY secret -- the old names were the only ones
# actually read here).
PIPELINE_DIR = Path(os.environ.get("DOCGENT_PIPELINE_DIR") or os.environ.get("DOCFORGE_PIPELINE_DIR", "/app/pipeline"))
API_KEY = os.environ.get("DOCGENT_API_KEY") or os.environ.get("DOCFORGE_API_KEY", "")
MAX_BODY_BYTES = int(os.environ.get("DOCGENT_MAX_BODY") or os.environ.get("DOCFORGE_MAX_BODY", 20 * 1024 * 1024))
RENDER_TIMEOUT = int(os.environ.get("DOCGENT_RENDER_TIMEOUT") or os.environ.get("DOCFORGE_RENDER_TIMEOUT", 90))

TEMPLATE = PIPELINE_DIR / "core" / "templates" / "document.html"
FILTER = PIPELINE_DIR / "core" / "filters" / "vocabulary.lua"
# Microtypography runs after the vocabulary filter: it refines prose the
# vocabulary filter may itself have emitted. Order matters, so this is a
# separate constant applied second rather than a glob over the filters dir.
MICROTYPE_FILTER = PIPELINE_DIR / "core" / "filters" / "microtype.lua"
BASE_CSS = PIPELINE_DIR / "core" / "css" / "base.css"
BRANDS_DIR = PIPELINE_DIR / "brands"

# Disable tex_math_dollars so $ currency signs in table cells aren't parsed as LaTeX math
# (the default markdown reader includes tex_math_dollars which causes garbled table output)
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
    "-tex_math_dollars"
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
  --accent-bright: {pal('accent_bright', pal('accent', '#1f4b6e'))};
  --band: {pal('band', pal('ink', '#12161c'))};
  --surface-quote: {pal('surface_quote', pal('paper_alt', '#f6f8fa'))};
  --surface-mute: {pal('surface_mute', pal('rule', '#dfe4ea'))};
  --surface-track: {pal('surface_track', pal('paper_alt', '#f6f8fa'))};
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
# Markdown pre-processor
# --------------------------------------------------------------------------- #

# Docgent shorthand uses double-colon delimiters: ::primitive{attrs} / ::
# Pandoc's fenced_divs extension requires triple colons: ::: {.class attr=val} / :::
# This pre-processor rewrites Docgent shorthand into pandoc-compatible fenced divs
# BEFORE the markdown reaches pandoc, so the Lua vocabulary filter fires correctly.
#
# Supported forms:
#   ::name                     -> ::: {.name}
#   ::name{key="val" key2=x}  -> ::: {.name key="val" key2=x}
#   ::                         -> :::
#
# The attrs string is kept verbatim — pandoc parses it as a key-value list.

import re as _re

_OPEN_RE  = _re.compile(r'^::([a-zA-Z][a-zA-Z0-9_-]*)(.*)$')
_CLOSE_RE = _re.compile(r'^::$')


def _process_comments(md: str, mode: str = 'strip') -> str:
    """Handle %%[...] ... %% block comments.

    mode='strip'  — remove entirely (PDF path, no trace in output).
    mode='anchor' — replace with an invisible <span data-comment-id="..."> so
                    the HTML preview can highlight and navigate to comments.
    """
    lines = md.split('\n')
    out = []
    in_comment = False
    comment_id = None
    for line in lines:
        stripped = line.strip()
        if not in_comment and stripped.startswith('%%['):
            in_comment = True
            if mode == 'anchor':
                # Extract id attr for the anchor element.
                import re as _re
                m = _re.search(r'id="([^"]+)"', stripped)
                comment_id = m.group(1) if m else f'comment-{len(out)}'
                # Emit a raw HTML span as an anchor; pandoc passes raw html blocks through.
                out.append(f'<span data-comment-id="{comment_id}" class="comment-anchor"></span>')
            continue
        if in_comment:
            if stripped == '%%':
                in_comment = False
                comment_id = None
            continue
        out.append(line)
    return '\n'.join(out)


def _preprocess_markdown(md: str, comment_mode: str = 'strip') -> str:
    """Rewrite ::primitive / :: shorthand into pandoc fenced-div syntax."""
    md = _process_comments(md, mode=comment_mode)
    lines = md.split('\n')
    out = []
    in_frontmatter = False
    fm_done = False
    for i, line in enumerate(lines):
        # Skip frontmatter block (between --- delimiters at top of file)
        stripped = line.strip()
        if i == 0 and stripped == '---':
            in_frontmatter = True
            out.append(line)
            continue
        if in_frontmatter:
            out.append(line)
            if stripped == '---':
                in_frontmatter = False
                fm_done = True
            continue

        # Rewrite ::primitive{attrs} -> ::: {.primitive attrs}
        m = _OPEN_RE.match(stripped)
        if m and line.startswith('::'):
            name  = m.group(1)
            attrs = m.group(2).strip()
            # Strip surrounding braces if present: {key=val} -> key=val
            if attrs.startswith('{') and attrs.endswith('}'):
                attrs = attrs[1:-1].strip()
            if attrs:
                out.append(f'::: {{.{name} {attrs}}}')
            else:
                out.append(f'::: {{.{name}}}')
            continue

        # Rewrite bare :: close delimiter -> :::
        if _CLOSE_RE.match(stripped) and line.strip() == '::':
            out.append(':::')
            continue

        out.append(line)
    return '\n'.join(out)


# --------------------------------------------------------------------------- #
# Render pipeline
# --------------------------------------------------------------------------- #

def _stage(work: Path, markdown: str, brand: dict, fm: dict,
           assets: dict[str, str] | None, comment_mode: str = 'strip'):
    """Writes markdown, assets and CSS into a working directory.

    Shared by the PDF and HTML paths so both render from identical inputs;
    if these diverged the preview would stop predicting the PDF.

    comment_mode='strip'  — comments removed entirely (PDF path).
    comment_mode='anchor' — comments replaced with <span data-comment-id> anchors (HTML preview).
    """
    md_path = work / "doc.md"
    md_path.write_text(_preprocess_markdown(markdown, comment_mode=comment_mode), encoding="utf-8")

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

    sheets = [tokens_css, BASE_CSS]
    brand_css = Path(brand["_dir"]) / "css" / "brand.css"
    if brand_css.exists():
        sheets.append(brand_css)
    return md_path, sheets


def _run_pandoc(md_path, html_path, brand, brand_id, fm, sheets, source_lines):
    # Brand-specific template override: if laurion/templates/document.html exists,
    # use it instead of the core template. This lets brands define a custom cover
    # without touching the shared core template.
    brand_template = Path(brand["_dir"]) / "templates" / "document.html"
    active_template = brand_template if brand_template.exists() else TEMPLATE

    cmd = [
        "pandoc",
        str(md_path),
        "--from", PANDOC_EXTENSIONS,
        "--to", "html5",
        "--standalone",
        "--template", str(active_template),
        "--lua-filter", str(FILTER),
        "--lua-filter", str(MICROTYPE_FILTER),
        "--section-divs",
        "--metadata", f"brandname={brand.get('name', brand_id)}",
        "-o", str(html_path),
    ]

    # Brand cover logo — inline as a base64 data URI so the remote render
    # worker can resolve it without a local filesystem path.
    cover_logo_rel = (brand.get("cover") or {}).get("logo")
    if cover_logo_rel:
        logo_path = Path(brand["_dir"]) / cover_logo_rel
        if logo_path.exists():
            mime = "image/svg+xml" if logo_path.suffix == ".svg" else "image/png"
            b64 = base64.b64encode(logo_path.read_bytes()).decode("ascii")
            data_uri = f"data:{mime};base64,{b64}"
            cmd += ["--metadata", f"brandlogo={data_uri}"]

    # Brand section autonumbering — if disabled in brand.yaml, tell the Lua
    # filter to skip adding the .numbered class to headings. Without this flag
    # the filter adds .numbered to every h1/h2, which causes the CSS counter
    # to prepend a number that double-counts when the author already wrote
    # an explicit "01 ·" prefix in the heading text.
    no_autonumber = not (
        (brand.get("numbering") or {}).get("sections", True)
    )
    if no_autonumber:
        cmd += ["--metadata", "docforge_no_autonumber=1"]

    if fm.get("toc"):
        cmd += ["--toc", "--toc-depth=2"]
    # Only the preview needs source positions. The PDF path leaves them off so
    # its output stays byte-identical to what it produced before this existed.
    if source_lines:
        cmd += ["--metadata", "docforge_source_lines=1"]
    for sheet in sheets:
        cmd += ["--css", str(sheet)]

    # Pandoc resolves relative image src paths against --resource-path so
    # WeasyPrint receives absolute file:// URLs rather than relative paths
    # that it cannot resolve from its working directory.
    cmd += ["--resource-path", str(md_path.parent)]

    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, timeout=RENDER_TIMEOUT)
    if proc.returncode != 0:
        raise RuntimeError(
            "pandoc failed: " + proc.stderr.decode("utf-8", "replace")[:2000]
        )
    return int((time.time() - t0) * 1000)


def render_pdf(markdown: str, brand_id: str, assets: dict[str, str] | None) -> bytes:
    brand = load_brand(brand_id)
    fm = read_frontmatter(markdown)

    with tempfile.TemporaryDirectory(prefix="docforge-") as tmp:
        work = Path(tmp)
        md_path, sheets = _stage(work, markdown, brand, fm, assets)

        html_path = work / "doc.html"
        g.pandoc_ms = _run_pandoc(
            md_path, html_path, brand, brand_id, fm, sheets, False
        )

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
        g.weasy_ms = int((time.time() - t1) * 1000)
        return pdf_path.read_bytes()


# Screen adjustments for the preview pane. WeasyPrint honours @page; browsers
# do not, so the preview reproduces the page box to keep measure and line
# breaks close to the PDF without pretending to paginate.
PREVIEW_CSS = """
/* injected by Docgent for the HTML preview pane only */
html { background: #edeef1; }
body { background: #edeef1; margin: 0; padding: 24px 0; }
body > nav.toc,
body > main {
  background: var(--paper, #fff);
  box-sizing: border-box;
  width: 210mm;
  max-width: 100%;
  margin: 0 auto 18px;
  padding: var(--margin-top, 22mm) var(--margin-outer, 20mm)
           var(--margin-bottom, 20mm) var(--margin-inner, 24mm);
  box-shadow: 0 1px 3px rgba(16, 22, 32, .14);
}
/* Cover: sizing/shadow only — do NOT set background.
 * Each brand defines its own cover background (dark, light, image-based).
 * Forcing var(--paper) here overrides the brand CSS and washes it white. */
body > section.cover {
  box-sizing: border-box;
  width: 210mm;
  max-width: 100%;
  margin: 0 auto 18px;
  box-shadow: 0 1px 3px rgba(16, 22, 32, .14);
}
[data-source-line] { scroll-margin-top: 8px; }
.src-anchor { display: contents; }
"""


def _inline_assets(html: str, work: Path) -> str:
    """Inlines local <img> sources as data URIs.

    The preview is handed to the browser as a standalone string, so relative
    paths into the worker temp dir would 404.
    """
    def repl(m):
        src = m.group(2)
        if src.startswith(("http://", "https://", "data:", "//")):
            return m.group(0)
        target = (work / src).resolve()
        if not str(target).startswith(str(work.resolve())) or not target.is_file():
            return m.group(0)
        mime, _ = mimetypes.guess_type(str(target))
        if not mime or not mime.startswith("image/"):
            return m.group(0)
        b64 = base64.b64encode(target.read_bytes()).decode("ascii")
        return m.group(1) + "data:" + mime + ";base64," + b64 + m.group(3)

    return re.sub(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', repl, html, flags=re.I)


def render_html(markdown: str, brand_id: str, assets: dict[str, str] | None) -> str:
    """Renders the same pandoc HTML the PDF is built from, self-contained.

    Stylesheets are inlined because the studio serves this into an iframe
    with no access to the worker filesystem.
    """
    brand = load_brand(brand_id)
    fm = read_frontmatter(markdown)

    with tempfile.TemporaryDirectory(prefix="docforge-") as tmp:
        work = Path(tmp)
        md_path, sheets = _stage(work, markdown, brand, fm, assets, comment_mode='anchor')

        html_path = work / "doc.html"
        g.pandoc_ms = _run_pandoc(
            md_path, html_path, brand, brand_id, fm, sheets, True
        )
        html = html_path.read_text(encoding="utf-8")

        blocks = []
        for sheet in sheets:
            try:
                blocks.append(sheet.read_text(encoding="utf-8"))
            except OSError:
                continue
        blocks.append(PREVIEW_CSS)
        style = "<style>\n" + "\n".join(blocks) + "\n</style>"

        # Drop <link> tags: they point at paths the browser cannot read.
        html = re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>', "", html, flags=re.I)
        html = _inline_assets(html, work)

        if "</head>" in html:
            html = html.replace("</head>", style + "\n</head>", 1)
        else:
            html = style + html
        return html

# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

@app.before_request
def _before():
    g.request_id = uuid.uuid4().hex[:12]
    g.t_start = time.time()


def authorised() -> bool:
    # Studio and the CLI both send X-Docgent-Key (packages/core/src/client.mjs,
    # apps/studio/src/lib/render.ts). The old X-DocForge-Key name is accepted
    # too, so a client on the previous header during a rolling deploy doesn't
    # get locked out mid-rollout.
    supplied = request.headers.get("X-Docgent-Key") or request.headers.get("X-DocForge-Key", "")
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
    # Parse extension tokens: split by '+', each token may itself contain '-' for
    # disabling sub-extensions (e.g. 'smart-tex_math_dollars' = +smart -tex_math_dollars).
    # Expand these into individual extension names for the availability check.
    required = set()
    for token in PANDOC_EXTENSIONS.split("+")[1:]:
        for part in token.split("-"):
            if part:
                required.add(part)
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
        "microtype_filter": MICROTYPE_FILTER.exists(),
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


@app.post("/render/html")
def render_html_route():
    """Renders to HTML for the studio preview pane.

    Separate from /render because the contracts differ: this is fast,
    self-contained, and carries source-line anchors for scroll sync.
    /render remains the fidelity path.
    """
    if not authorised():
        jlog("render_html.unauthorised", ip=request.remote_addr)
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
        html = render_html(markdown, str(brand_id), assets)
    except FileNotFoundError as e:
        return jsonify(error=str(e)), 404
    except ValueError as e:
        return jsonify(error=str(e)), 400
    except subprocess.TimeoutExpired:
        return jsonify(error="render timed out"), 504
    except RuntimeError as e:
        jlog("render_html.failed", brand=brand_id, error=str(e)[:500])
        return jsonify(error=str(e)), 422

    total_ms = int((time.time() - g.t_start) * 1000)
    jlog("render_html.ok", brand=brand_id, bytes=len(html),
         pandoc_ms=getattr(g, "pandoc_ms", None), total_ms=total_ms)

    return (
        html,
        200,
        {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-DocForge-Request-Id": g.request_id,
            "X-DocForge-Render-Ms": str(total_ms),
        },
    )

def render_thumbnail(markdown: str, brand_id: str, assets: dict[str, str] | None) -> bytes:
    """Renders page 1 of the PDF to a PNG, for the version filmstrip.

    Reuses render_pdf's output rather than a separate render path: the
    thumbnail must be pixel-true to the artefact it represents, not a
    lighter approximation that could drift from what actually prints.
    pdftoppm (poppler-utils) rasterises the existing PDF; no second
    HTML/CSS pass.
    """
    pdf_bytes = render_pdf(markdown, brand_id, assets)

    with tempfile.TemporaryDirectory(prefix="docforge-thumb-") as tmp:
        work = Path(tmp)
        pdf_path = work / "doc.pdf"
        pdf_path.write_bytes(pdf_bytes)

        out_prefix = work / "thumb"
        proc = subprocess.run(
            ["pdftoppm", "-png", "-f", "1", "-l", "1", "-scale-to-x", "480",
             "-scale-to-y", "-1", str(pdf_path), str(out_prefix)],
            capture_output=True,
            timeout=30,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "pdftoppm failed: " + proc.stderr.decode("utf-8", "replace")[:1000]
            )

        # pdftoppm names single-page output "<prefix>-1.png" or "<prefix>.png"
        # depending on version; check both rather than assuming.
        for candidate in (work / "thumb-1.png", work / "thumb.png", work / "thumb-01.png"):
            if candidate.exists():
                return candidate.read_bytes()
        raise RuntimeError("pdftoppm produced no output file")


@app.post("/thumbnail")
def thumbnail_route():
    """Renders page 1 as a PNG thumbnail, for the studio version filmstrip.

    Same request contract as /render (markdown + brand + assets) so callers
    that already have a render payload can request a thumbnail with no
    reshaping. Content-addressing and caching are the studio's concern; this
    endpoint is stateless like /render.
    """
    if not authorised():
        jlog("thumbnail.unauthorised", ip=request.remote_addr)
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
        png = render_thumbnail(markdown, str(brand_id), assets)
    except FileNotFoundError as e:
        jlog("thumbnail.unknown_brand", brand=brand_id, error=str(e))
        return jsonify(error=str(e)), 404
    except ValueError as e:
        return jsonify(error=str(e)), 400
    except subprocess.TimeoutExpired:
        jlog("thumbnail.timeout", brand=brand_id)
        return jsonify(error="render timed out"), 504
    except RuntimeError as e:
        jlog("thumbnail.failed", brand=brand_id, error=str(e)[:500])
        return jsonify(error=str(e)), 422

    total_ms = int((time.time() - g.t_start) * 1000)
    jlog("thumbnail.ok", brand=brand_id, bytes=len(png), total_ms=total_ms)

    return (
        png,
        200,
        {
            "Content-Type": "image/png",
            "Cache-Control": "private, max-age=31536000, immutable",
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
