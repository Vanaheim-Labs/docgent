#!/usr/bin/env python3
"""migrate-svg-figures.py — extract inline SVG from doc.md into figures/.

Scans a doc.md for ::chart or ::figure blocks that contain inline SVG content
(no src= attribute) and migrates each one to an external file in figures/.

After migration the block is replaced with a compact one-liner that references
the new file:

    ::chart{src="figures/chart-1.svg" caption="..." width="..."}

Usage
-----
    python3 scripts/migrate-svg-figures.py path/to/doc.md

The script rewrites doc.md in-place and writes the extracted SVG files into a
figures/ directory alongside it.  It is safe to run multiple times: blocks
that already carry a src= attribute are skipped.

Formats handled
---------------
1. Docgent shorthand + body (what _preprocess_markdown produces after its
   normalisation pass):

       ::chart{caption="Revenue" width="90%"}
       <svg ...>
       ...
       </svg>
       ::

2. Pandoc fenced-div format (output of _preprocess_markdown):

       :::{.chart caption="Revenue" width="90%"}
       <svg ...>
       ...
       </svg>
       :::
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

# Form 1: Docgent shorthand with a body
#   ::name{attrs}
#   ...SVG body...
#   ::
_SHORTHAND_OPEN_RE = re.compile(
    r'^::(figure|chart)\{([^}]*)\}\s*$',
)
_SHORTHAND_CLOSE = '::'

# Form 2: Pandoc fenced div
#   :::{.name attrs}
#   ...SVG body...
#   :::
_PANDOC_OPEN_RE = re.compile(
    r'^:::\{\.(?:figure|chart)([^}]*)\}\s*$',
    re.IGNORECASE,
)
_PANDOC_CLASS_RE = re.compile(r'\.(figure|chart)\b', re.IGNORECASE)
_PANDOC_CLOSE = ':::'

# Already has a src= attribute — skip.
_SRC_ATTR_RE = re.compile(r'\bsrc="[^"]+"', re.IGNORECASE)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _has_svg(lines: list[str]) -> bool:
    return any('<svg' in l for l in lines)


def _strip_src(attrs: str) -> str:
    return re.sub(r'\s*\bsrc="[^"]*"', '', attrs, flags=re.IGNORECASE).strip()


def _build_oneliner(prim: str, attrs: str, svg_rel: str) -> str:
    """Build the replacement one-liner reference block."""
    clean = _strip_src(attrs).strip()
    if clean:
        return f'::{prim}{{src="{svg_rel}" {clean}}}'
    return f'::{prim}{{src="{svg_rel}"}}'


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------

def migrate(doc_path: Path) -> None:
    text = doc_path.read_text(encoding='utf-8')
    lines = text.splitlines(keepends=True)

    figures_dir = doc_path.parent / 'figures'
    counter: dict[str, int] = {}  # prim -> count

    out: list[str] = []
    extracted: list[tuple[str, str]] = []  # (svg_filename, reason)

    i = 0
    while i < len(lines):
        line = lines[i].rstrip('\n').rstrip('\r')

        # --- Form 1: shorthand ---
        m1 = _SHORTHAND_OPEN_RE.match(line)
        if m1:
            prim = m1.group(1)   # 'figure' or 'chart'
            attrs = m1.group(2)
            if _SRC_ATTR_RE.search(attrs):
                # Already externalised — pass through unchanged.
                out.append(lines[i])
                i += 1
                continue
            # Collect body until bare '::'
            body: list[str] = []
            j = i + 1
            while j < len(lines):
                bl = lines[j].rstrip('\n').rstrip('\r')
                if bl.strip() == _SHORTHAND_CLOSE:
                    break
                body.append(lines[j])
                j += 1
            if j >= len(lines) or not _has_svg(body):
                # Unterminated or no SVG — pass through.
                out.append(lines[i])
                i += 1
                continue
            # Extract SVG.
            counter[prim] = counter.get(prim, 0) + 1
            svg_name = f'{prim}-{counter[prim]}.svg'
            svg_rel = f'figures/{svg_name}'
            svg_body = ''.join(body).strip()
            figures_dir.mkdir(exist_ok=True)
            (figures_dir / svg_name).write_text(svg_body + '\n', encoding='utf-8')
            extracted.append((svg_name, f'from shorthand block at line {i + 1}'))
            # Emit replacement one-liner + newline.
            out.append(_build_oneliner(prim, attrs, svg_rel) + '\n')
            i = j + 1  # skip body + closing '::'
            continue

        # --- Form 2: pandoc fenced div ---
        m2 = _PANDOC_OPEN_RE.match(line)
        if m2:
            inner_attrs = m2.group(1)
            # Extract primitive name from .figure or .chart class.
            cls_m = _PANDOC_CLASS_RE.search(line)
            prim = cls_m.group(1).lower() if cls_m else 'figure'
            # Remove the class token itself from attrs.
            attrs = re.sub(r'\s*\.' + prim, '', inner_attrs, count=1, flags=re.IGNORECASE).strip()
            if _SRC_ATTR_RE.search(attrs):
                out.append(lines[i])
                i += 1
                continue
            body = []
            j = i + 1
            while j < len(lines):
                bl = lines[j].rstrip('\n').rstrip('\r')
                if bl.strip() == _PANDOC_CLOSE:
                    break
                body.append(lines[j])
                j += 1
            if j >= len(lines) or not _has_svg(body):
                out.append(lines[i])
                i += 1
                continue
            counter[prim] = counter.get(prim, 0) + 1
            svg_name = f'{prim}-{counter[prim]}.svg'
            svg_rel = f'figures/{svg_name}'
            svg_body = ''.join(body).strip()
            figures_dir.mkdir(exist_ok=True)
            (figures_dir / svg_name).write_text(svg_body + '\n', encoding='utf-8')
            extracted.append((svg_name, f'from fenced div at line {i + 1}'))
            out.append(_build_oneliner(prim, attrs, svg_rel) + '\n')
            i = j + 1
            continue

        # Passthrough.
        out.append(lines[i])
        i += 1

    if not extracted:
        print('No inline SVG blocks found — nothing to migrate.')
        return

    doc_path.write_text(''.join(out), encoding='utf-8')

    print(f'Migrated {len(extracted)} SVG block(s):')
    for name, reason in extracted:
        print(f'  figures/{name}  ({reason})')
    print(f'\nUpdated: {doc_path}')
    print(f'Created: {figures_dir}/')


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description='Extract inline SVG from doc.md into figures/ directory.',
    )
    parser.add_argument('doc', metavar='path/to/doc.md', help='Path to the doc.md to migrate.')
    args = parser.parse_args()

    doc_path = Path(args.doc).resolve()
    if not doc_path.is_file():
        print(f'Error: {doc_path} does not exist or is not a file.', file=sys.stderr)
        sys.exit(1)
    if doc_path.name != 'doc.md':
        print(f'Warning: expected a file named doc.md, got {doc_path.name!r}. Proceeding anyway.')

    migrate(doc_path)


if __name__ == '__main__':
    main()
