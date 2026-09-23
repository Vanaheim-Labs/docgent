#!/usr/bin/env python3
"""Generate a brand-faithful reference.docx for each brand.

Reads brand.yaml, uses python-docx to programmatically build a Word
reference document with branded heading styles, page margins, running
headers/footers, and a thin rule separator.  The reference.docx is what
pandoc uses via --reference-doc to apply consistent styling to DOCX exports.

Usage:
    python3 generate_reference_docx.py <brand-id>
    python3 generate_reference_docx.py --all-brands

The script resolves brands relative to the DOCGENT_PIPELINE_DIR env var
(defaulting to /app/pipeline when running in Docker, or the pipeline/
subdirectory of the render-worker directory when running locally).
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys
import zipfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Dependency check: python-docx and yaml
# ---------------------------------------------------------------------------
try:
    from docx import Document
    from docx.shared import Pt, Cm, RGBColor, Emu
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
except ImportError:
    print("ERROR: python-docx is not installed.  Run: pip install python-docx", file=sys.stderr)
    sys.exit(1)

try:
    from lxml import etree as _lxml_etree
    _HAVE_LXML = True
except ImportError:
    _HAVE_LXML = False

try:
    import yaml as _yaml
    def _load_yaml(text: str) -> dict:
        return _yaml.safe_load(text) or {}
except ImportError:
    # Fallback: use the same parse_simple_yaml as server.py
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

    def _load_yaml(text: str) -> dict:  # type: ignore[misc]
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MM_PER_EMU = 1 / 36000  # 1 mm = 36000 EMU


def _mm(mm_str: str | float | int) -> Emu:
    """Convert a CSS mm string like '22mm' or bare number to EMU."""
    if isinstance(mm_str, (int, float)):
        return Emu(int(mm_str * 36000))
    m = re.match(r"([\d.]+)\s*mm", str(mm_str).strip())
    if m:
        return Emu(int(float(m.group(1)) * 36000))
    # Fallback: treat as pt
    m2 = re.match(r"([\d.]+)\s*pt", str(mm_str).strip())
    if m2:
        return Emu(int(float(m2.group(1)) * 12700))
    return Emu(int(20 * 36000))  # 20 mm default


def _hex_to_rgb(hex_str: str) -> RGBColor:
    """Convert '#RRGGBB' to RGBColor.  Strips # and quotes."""
    h = str(hex_str).strip().strip('"').strip("'").lstrip("#")
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    h = h[:6].ljust(6, "0")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return RGBColor(r, g, b)


def _hex_bare(hex_str: str) -> str:
    """Return the bare RRGGBB hex string (no #) for direct XML use."""
    h = str(hex_str).strip().strip('"').strip("'").lstrip("#")
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    return h[:6].upper().ljust(6, "0")


def _first_font_family(css_stack: str) -> str:
    """Extract the first usable font family name from a CSS font stack.

    e.g. '"Crimson Pro", Georgia, serif'  →  'Crimson Pro'
         'Inter, Helvetica Neue, Arial, sans-serif'  →  'Inter'
    """
    # Remove generic family keywords at the end
    css_stack = re.sub(
        r",?\s*(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$",
        "", css_stack.strip(), flags=re.IGNORECASE,
    )
    # Split on comma, take the first
    first = css_stack.split(",")[0].strip()
    # Strip surrounding quotes
    first = first.strip('"').strip("'")
    return first or "Calibri"


def _set_run_font(run, font_name: str, sz_pt: float, bold: bool = False,
                  color: RGBColor | None = None, caps: bool = False,
                  small_caps: bool = False) -> None:
    run.font.name = font_name
    run.font.size = Pt(sz_pt)
    run.font.bold = bold
    if color:
        run.font.color.rgb = color
    if caps or small_caps:
        rPr = run._r.get_or_add_rPr()
        if caps:
            caps_el = OxmlElement("w:caps")
            caps_el.set(qn("w:val"), "1")
            rPr.append(caps_el)
        if small_caps:
            sc_el = OxmlElement("w:smallCaps")
            sc_el.set(qn("w:val"), "1")
            rPr.append(sc_el)


def _apply_style(style, font_name: str, sz_pt: float, bold: bool = False,
                 color: RGBColor | None = None, caps: bool = False,
                 small_caps: bool = False,
                 space_before_pt: float = 0, space_after_pt: float = 0) -> None:
    """Apply font / paragraph settings to a paragraph *style* object."""
    style.font.name = font_name
    # Word uses a "theme font" override unless we set both ASCII and HAnsi
    rPr = style.element.get_or_add_rPr()
    # Clear existing rFonts then set
    for el in rPr.findall(qn("w:rFonts")):
        rPr.remove(el)
    rFonts = OxmlElement("w:rFonts")
    rFonts.set(qn("w:ascii"), font_name)
    rFonts.set(qn("w:hAnsi"), font_name)
    rFonts.set(qn("w:cs"), font_name)
    rPr.insert(0, rFonts)

    style.font.size = Pt(sz_pt)
    style.font.bold = bold
    if color:
        style.font.color.rgb = color

    if caps:
        el = OxmlElement("w:caps")
        el.set(qn("w:val"), "1")
        rPr.append(el)
    if small_caps:
        el = OxmlElement("w:smallCaps")
        el.set(qn("w:val"), "1")
        rPr.append(el)

    pf = style.paragraph_format
    pf.space_before = Pt(space_before_pt)
    pf.space_after = Pt(space_after_pt)


def _border_xml(color_hex: str, sz: int = 4, space: int = 1,
                val: str = "single") -> OxmlElement:
    """Create a <w:pBdr><w:bottom .../></w:pBdr> element."""
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), val)
    bottom.set(qn("w:sz"), str(sz))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), _hex_bare(color_hex))
    pBdr.append(bottom)
    return pBdr


def _set_section_margins(section, margin_top, margin_bottom,
                          margin_inner, margin_outer) -> None:
    section.top_margin = margin_top
    section.bottom_margin = margin_bottom
    section.left_margin = margin_inner   # left = inner (typical)
    section.right_margin = margin_outer  # right = outer (typical)
    section.header_distance = Emu(12 * 36000)  # 12 mm gap header→text
    section.footer_distance = Emu(10 * 36000)  # 10 mm gap text→footer
    section.different_first_page_header_footer = False


def _add_field_run(paragraph, fld_char_type: str, instr: str | None = None):
    """
    Append a field element sequence to a paragraph.
    call three times: begin, separate (with instr), end.
    """
    run = paragraph.add_run()
    fldChar = OxmlElement("w:fldChar")
    fldChar.set(qn("w:fldCharType"), fld_char_type)
    run._r.append(fldChar)
    if instr and fld_char_type == "begin":
        # instrText goes in its own run
        pass  # handled by caller
    return run


def _add_field(paragraph, field_code: str):
    """Add a Word field (PAGE, NUMPAGES, TITLE, etc.) to a paragraph."""
    # Begin
    r_begin = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    r_begin._r.append(fld_begin)
    # Instruction
    r_instr = paragraph.add_run()
    instr = OxmlElement("w:instrText")
    instr.text = f" {field_code} "
    instr.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    r_instr._r.append(instr)
    # Separate
    r_sep = paragraph.add_run()
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    r_sep._r.append(fld_sep)
    # End
    r_end = paragraph.add_run()
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    r_end._r.append(fld_end)


def _add_tab_stop_right(paragraph, position_emu: int) -> None:
    """Add a right-aligned tab stop at position_emu to a paragraph."""
    pPr = paragraph._p.get_or_add_pPr()
    tabs_existing = pPr.find(qn("w:tabs"))
    if tabs_existing is None:
        tabs_el = OxmlElement("w:tabs")
        pPr.append(tabs_el)
    else:
        tabs_el = tabs_existing
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), "right")
    tab.set(qn("w:pos"), str(position_emu // 635))  # convert EMU to twentieths-of-pt
    tabs_el.append(tab)


def _clear_paragraph(paragraph) -> None:
    """Remove all runs from a paragraph."""
    p = paragraph._p
    for r in p.findall(qn("w:r")):
        p.remove(r)
    for hlink in p.findall(qn("w:hyperlink")):
        p.remove(hlink)


def _add_rule_border_to_paragraph(paragraph, color_hex: str) -> None:
    """Add a bottom border rule line to a paragraph (used for header separator)."""
    pPr = paragraph._p.get_or_add_pPr()
    # Remove existing pBdr
    for el in pPr.findall(qn("w:pBdr")):
        pPr.remove(el)
    pBdr = _border_xml(color_hex)
    pPr.append(pBdr)


# ---------------------------------------------------------------------------
# Font embedding
# ---------------------------------------------------------------------------

# OOXML namespaces used in fontTable.xml and its .rels file
_W_NS  = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_R_NS  = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_FONT_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"
)

# Map filename stem keywords → OOXML embed-variant element name
# Order matters: check bolditalic before bold/italic.
_VARIANT_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"bolditalic|boldit|bi",   re.I), "embedBoldItalic"),
    (re.compile(r"semibolditalic|semibold", re.I), None),   # skip semibold — Word has no slot
    (re.compile(r"bold",                   re.I), "embedBold"),
    (re.compile(r"italic|it(?![a-z])",    re.I), "embedItalic"),
    (re.compile(r"medium|light",           re.I), None),   # no standard OOXML slot
]


def _filename_to_variant(stem: str) -> str | None:
    """Map a TTF filename stem to an OOXML embedXxx attribute name, or None to skip."""
    for pattern, slot in _VARIANT_RULES:
        if pattern.search(stem):
            return slot   # None means 'recognised but no Word slot'
    # No weight keyword → treat as Regular
    return "embedRegular"


def _filename_to_family(stem: str) -> str:
    """Derive the CSS/Word family name from a TTF filename stem.

    e.g. 'Figtree-Regular' → 'Figtree'
         'CrimsonPro-Bold'  → 'Crimson Pro'
    """
    # Strip weight/style suffix after last hyphen (if any)
    base = stem.split("-")[0]
    # Insert spaces before CamelCase word boundaries (e.g. CrimsonPro → Crimson Pro)
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", base)


def embed_brand_fonts(docx_path: str | Path, font_dir: str | Path) -> int:
    """Embed all TTF files found in *font_dir* into the DOCX at *docx_path*.

    Modifies the file in-place.  Returns the number of font variants embedded.
    Skips weight variants that have no OOXML slot (semibold, medium, light).
    Requires lxml; no-ops silently if lxml is unavailable.
    """
    if not _HAVE_LXML:
        print("  ⚠ lxml not available — font embedding skipped", file=sys.stderr)
        return 0

    font_dir = Path(font_dir)
    ttf_files = sorted(font_dir.glob("*.ttf"))
    if not ttf_files:
        print(f"  ⚠ no TTF files found in {font_dir} — embedding skipped", file=sys.stderr)
        return 0

    # Build an embedding plan: [(family, variant_tag, path), ...]
    plan: list[tuple[str, str, Path]] = []
    for ttf in ttf_files:
        stem = ttf.stem
        variant = _filename_to_variant(stem)
        if variant is None:
            continue   # no OOXML slot for this weight
        family = _filename_to_family(stem)
        plan.append((family, variant, ttf))

    if not plan:
        return 0

    # ---- Read entire DOCX zip into memory ----------------------------------
    docx_path = Path(docx_path)
    with zipfile.ZipFile(docx_path, "r") as z:
        arc_names = z.namelist()
        files: dict[str, bytes] = {n: z.read(n) for n in arc_names}

    # ---- 1. Patch settings.xml — add embedTrueTypeFonts -------------------
    settings_xml = files.get("word/settings.xml", b"")
    if b"embedTrueTypeFonts" not in settings_xml:
        settings_xml = settings_xml.replace(
            b"</w:settings>",
            b"<w:embedTrueTypeFonts/><w:embedSystemFonts/></w:settings>",
        )
        files["word/settings.xml"] = settings_xml

    # ---- 2. Parse fontTable.xml -------------------------------------------
    ft_path = "word/fontTable.xml"
    ft_xml = files.get(ft_path, b"")
    if ft_xml:
        ft_root = _lxml_etree.fromstring(ft_xml)
    else:
        ft_root = _lxml_etree.fromstring(
            b'<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
        )

    # ---- 3. Parse (or create) fontTable.xml.rels --------------------------
    rels_path = "word/_rels/fontTable.xml.rels"
    if rels_path in files:
        rels_root = _lxml_etree.fromstring(files[rels_path])
    else:
        rels_root = _lxml_etree.fromstring(
            b'<?xml version="1.0" encoding="UTF-8"?>'
            b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
        )

    existing_ids = {el.get("Id", "") for el in rels_root}
    rel_counter = max(
        (int(i[3:]) for i in existing_ids if i.startswith("rId") and i[3:].isdigit()),
        default=0,
    )

    # ---- 4. Embed each font variant ----------------------------------------
    w = "{" + _W_NS + "}"
    embedded = 0
    for family, variant_tag, ttf_path in plan:
        arc_name = f"word/fonts/{ttf_path.name}"
        files[arc_name] = ttf_path.read_bytes()

        rel_counter += 1
        rel_id = f"rId{rel_counter}"

        # Add relationship
        rel_el = _lxml_etree.SubElement(rels_root, "Relationship")
        rel_el.set("Id", rel_id)
        rel_el.set("Type", _FONT_REL_TYPE)
        rel_el.set("Target", f"fonts/{ttf_path.name}")

        # Find or create <w:font w:name="FamilyName"> in fontTable.xml
        font_el = None
        for f in ft_root.findall(f"{w}font"):
            if f.get(f"{w}name") == family:
                font_el = f
                break
        if font_el is None:
            font_el = _lxml_etree.SubElement(ft_root, f"{w}font")
            font_el.set(f"{w}name", family)

        # Add <w:embedRegular r:id="rId..."/> (or Bold/Italic/BoldItalic)
        embed_el = _lxml_etree.SubElement(font_el, f"{w}{variant_tag}")
        embed_el.set(f"{{{_R_NS}}}id", rel_id)
        embedded += 1

    # ---- 5. Patch [Content_Types].xml — declare .ttf content type ---------
    # Without this Word cannot identify the font files, flags them as
    # "unreadable content", strips them during recovery, and shows the
    # scary repair dialog.  Adding a Default entry for .ttf is enough.
    ct_xml = files.get("[Content_Types].xml", b"")
    if ct_xml and b'Extension="ttf"' not in ct_xml:
        ct_xml = ct_xml.replace(
            b"</Types>",
            b'<Default Extension="ttf"'
            b' ContentType="application/x-font-ttf"/>'
            b"</Types>",
        )
        files["[Content_Types].xml"] = ct_xml

    # ---- 6. Serialise patched XML back ------------------------------------
    files[ft_path] = _lxml_etree.tostring(
        ft_root, xml_declaration=True, encoding="UTF-8", standalone=True
    )
    files[rels_path] = _lxml_etree.tostring(
        rels_root, xml_declaration=True, encoding="UTF-8", standalone=True
    )

    # ---- 6. Rewrite DOCX zip in-place -------------------------------------
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)

    docx_path.write_bytes(buf.getvalue())
    return embedded


# ---------------------------------------------------------------------------
# Page width helpers
# ---------------------------------------------------------------------------

A4_WIDTH_EMU = int(210 * 36000)   # 210 mm in EMU
A4_HEIGHT_EMU = int(297 * 36000)  # 297 mm in EMU


def _text_width_emu(margin_inner: Emu, margin_outer: Emu) -> int:
    """Approximate text-column width in EMU for A4."""
    return A4_WIDTH_EMU - int(margin_inner) - int(margin_outer)


# ---------------------------------------------------------------------------
# Core generator
# ---------------------------------------------------------------------------

def generate_reference_docx(brand_id: str, brands_dir: Path, output_path: Path) -> None:
    yaml_path = brands_dir / brand_id / "brand.yaml"
    if not yaml_path.exists():
        raise FileNotFoundError(f"No brand.yaml for brand '{brand_id}' at {yaml_path}")

    brand = _load_yaml(yaml_path.read_text(encoding="utf-8"))

    # --- Extract brand tokens -----------------------------------------------
    t = brand.get("typography") or {}
    p = brand.get("palette") or {}
    pg = brand.get("page") or {}

    serif_stack = t.get("serif") or "Georgia, serif"
    sans_stack  = t.get("sans")  or "Helvetica, Arial, sans-serif"

    serif_font = _first_font_family(serif_stack)
    sans_font  = _first_font_family(sans_stack)

    def pal(key: str, default: str = "#333333") -> str:
        return p.get(key) or default

    accent_rgb  = _hex_to_rgb(pal("accent",  "#333333"))
    ink_rgb     = _hex_to_rgb(pal("ink",     "#111111"))
    rule_color  = pal("rule", "#cccccc")

    margin_top    = _mm(pg.get("margin_top",    "22mm"))
    margin_bottom = _mm(pg.get("margin_bottom", "20mm"))
    margin_inner  = _mm(pg.get("margin_inner",  "24mm"))
    margin_outer  = _mm(pg.get("margin_outer",  "20mm"))

    brand_name = brand.get("name") or brand_id

    # --- Build document -----------------------------------------------------
    doc = Document()

    # Remove default empty paragraph so the document stays clean.
    # (We'll re-add dummy content for each style below.)
    for p_el in list(doc.paragraphs):
        p_el._element.getparent().remove(p_el._element)

    # --- Section / page setup -----------------------------------------------
    section = doc.sections[0]
    section.page_width  = Emu(A4_WIDTH_EMU)
    section.page_height = Emu(A4_HEIGHT_EMU)
    _set_section_margins(section, margin_top, margin_bottom, margin_inner, margin_outer)

    # Text width for tab stop at right margin
    text_width_emu = _text_width_emu(margin_inner, margin_outer)
    # Tab position in twips (1/20 pt); 1 pt = 12700 EMU, so 1 twip = 635 EMU
    tab_twips = text_width_emu // 635

    # --- Heading styles ---------------------------------------------------------

    def _configure_heading(style_name: str, font_name: str, sz_pt: float,
                           color: RGBColor, bold: bool = True, caps: bool = False,
                           small_caps: bool = False, space_before_pt: float = 12,
                           space_after_pt: float = 6) -> None:
        try:
            style = doc.styles[style_name]
        except KeyError:
            style = doc.styles.add_style(style_name, 1)  # 1 = WD_STYLE_TYPE.PARAGRAPH
        _apply_style(
            style, font_name=font_name, sz_pt=sz_pt, bold=bold, color=color,
            caps=caps, small_caps=small_caps,
            space_before_pt=space_before_pt, space_after_pt=space_after_pt,
        )

    # Heading 1: serif, 28pt, bold, accent colour, 18pt above
    _configure_heading("Heading 1", serif_font, 28, accent_rgb,
                       bold=True, space_before_pt=18, space_after_pt=8)

    # Heading 2: serif, 18pt, bold, ink colour, 14pt above
    _configure_heading("Heading 2", serif_font, 18, ink_rgb,
                       bold=True, space_before_pt=14, space_after_pt=6)

    # Heading 3: sans, 13pt, bold, small caps, accent colour, 10pt above
    _configure_heading("Heading 3", sans_font, 13, accent_rgb,
                       bold=True, small_caps=True, space_before_pt=10, space_after_pt=4)

    # Heading 4: sans, 11pt, bold, ink_soft
    ink_soft_rgb = _hex_to_rgb(pal("ink_soft", "#454e5a"))
    _configure_heading("Heading 4", sans_font, 11, ink_soft_rgb,
                       bold=True, space_before_pt=8, space_after_pt=3)

    # --- Normal / Body text -------------------------------------------------
    try:
        normal_style = doc.styles["Normal"]
    except KeyError:
        normal_style = doc.styles.add_style("Normal", 1)
    _apply_style(normal_style, font_name=sans_font, sz_pt=10.5,
                 color=ink_rgb, space_before_pt=0, space_after_pt=6)

    # --- Body Text (explicit style often used by pandoc) --------------------
    try:
        body_style = doc.styles["Body Text"]
    except KeyError:
        body_style = doc.styles.add_style("Body Text", 1)
    _apply_style(body_style, font_name=sans_font, sz_pt=10.5,
                 color=ink_rgb, space_before_pt=0, space_after_pt=6)

    # --- First Paragraph (often used by pandoc for the first body para) -----
    try:
        first_style = doc.styles["First Paragraph"]
    except KeyError:
        first_style = doc.styles.add_style("First Paragraph", 1)
    _apply_style(first_style, font_name=sans_font, sz_pt=10.5,
                 color=ink_rgb, space_before_pt=0, space_after_pt=6)

    # --- Dummy placeholder paragraphs so pandoc can see each style ----------
    # Pandoc reads the reference.docx and extracts the named styles.  We need
    # at least one paragraph in each style so the styles are "used" and thus
    # survive round-tripping through the docx XML.
    styles_to_seed = ["Heading 1", "Heading 2", "Heading 3", "Normal"]
    for sname in styles_to_seed:
        try:
            ph = doc.add_paragraph(f"[{sname} placeholder]")
            ph.style = doc.styles[sname]
        except Exception:
            pass

    # --- Running header -----------------------------------------------------
    section.header_distance = Emu(10 * 36000)  # 10 mm
    header = section.header
    # Clear the default empty paragraph Word adds
    if header.paragraphs:
        hpara = header.paragraphs[0]
    else:
        hpara = header.add_paragraph()

    _clear_paragraph(hpara)
    hpara.paragraph_format.space_after = Pt(2)

    # Add right-aligned tab stop at text width
    pPr = hpara._p.get_or_add_pPr()
    tabs_el = OxmlElement("w:tabs")
    tab_el = OxmlElement("w:tab")
    tab_el.set(qn("w:val"), "right")
    tab_el.set(qn("w:pos"), str(tab_twips))
    tabs_el.append(tab_el)
    pPr.append(tabs_el)

    # Left: brand name
    r_left = hpara.add_run(brand_name)
    r_left.font.name = sans_font
    r_left.font.size = Pt(8)
    r_left.font.color.rgb = _hex_to_rgb(pal("ink_faint", "#8a94a1"))

    # Tab
    tab_run = hpara.add_run()
    tab_run._r.append(OxmlElement("w:tab"))

    # Right: TITLE field
    r_right = hpara.add_run()
    r_right.font.name = sans_font
    r_right.font.size = Pt(8)
    r_right.font.color.rgb = _hex_to_rgb(pal("ink_faint", "#8a94a1"))
    _add_field(hpara, "TITLE")

    # Add a bottom border rule to the header paragraph
    _add_rule_border_to_paragraph(hpara, rule_color)

    # --- Running footer -----------------------------------------------------
    section.footer_distance = Emu(10 * 36000)  # 10 mm
    footer = section.footer
    if footer.paragraphs:
        fpara = footer.paragraphs[0]
    else:
        fpara = footer.add_paragraph()

    _clear_paragraph(fpara)
    fpara.paragraph_format.space_before = Pt(2)

    # Add right-aligned tab stop
    fpPr = fpara._p.get_or_add_pPr()
    ftabs_el = OxmlElement("w:tabs")
    ftab_el = OxmlElement("w:tab")
    ftab_el.set(qn("w:val"), "right")
    ftab_el.set(qn("w:pos"), str(tab_twips))
    ftabs_el.append(ftab_el)
    fpPr.append(ftabs_el)

    # Left: brand name
    fr_left = fpara.add_run(brand_name)
    fr_left.font.name = sans_font
    fr_left.font.size = Pt(8)
    fr_left.font.color.rgb = _hex_to_rgb(pal("ink_faint", "#8a94a1"))

    # Tab
    ftab_run = fpara.add_run()
    ftab_run._r.append(OxmlElement("w:tab"))

    # Right: PAGE / NUMPAGES field
    fr_right = fpara.add_run()
    fr_right.font.name = sans_font
    fr_right.font.size = Pt(8)
    fr_right.font.color.rgb = _hex_to_rgb(pal("ink_faint", "#8a94a1"))
    _add_field(fpara, "PAGE")
    sep_run = fpara.add_run(" / ")
    sep_run.font.name = sans_font
    sep_run.font.size = Pt(8)
    sep_run.font.color.rgb = _hex_to_rgb(pal("ink_faint", "#8a94a1"))
    _add_field(fpara, "NUMPAGES")

    # --- Save ---------------------------------------------------------------
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(output_path))

    # --- Optional font embedding -------------------------------------------
    if t.get("embed_fonts"):
        # Fonts come from pipeline/fonts/<brand_id>/ (staged by stage.mjs).
        # Resolve relative to the brands dir: fonts live one level up under
        # pipeline/fonts/, i.e. brands_dir/../fonts/<brand_id>/ when staged,
        # or brands/<brand_id>/fonts/ in the monorepo source tree.
        font_dirs_to_try = [
            brands_dir.parent / "fonts" / brand_id,        # staged pipeline layout
            brands_dir / brand_id / "fonts",                # monorepo source layout
        ]
        font_dir = next((d for d in font_dirs_to_try if d.is_dir()), None)
        if font_dir is None:
            print(
                f"  ⚠ {brand_id}: embed_fonts=true but no font directory found "
                f"(tried: {', '.join(str(d) for d in font_dirs_to_try)})",
                file=sys.stderr,
            )
        else:
            n = embed_brand_fonts(output_path, font_dir)
            size_kb = output_path.stat().st_size // 1024
            print(f"    embedded {n} font variant(s) from {font_dir} → {size_kb} KB")

    print(f"  ✓ {brand_id}: {output_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _resolve_brands_dir() -> Path:
    """Find the brands directory from env or relative to this script."""
    env = os.environ.get("DOCGENT_PIPELINE_DIR") or os.environ.get("DOCFORGE_PIPELINE_DIR")
    if env:
        return Path(env) / "brands"
    # Running locally: two levels up from apps/render-worker/ → repo root → brands
    here = Path(__file__).parent
    for candidate in [
        here / "pipeline" / "brands",          # staged copy (Docker / post-stage.mjs)
        here.parent.parent / "brands",          # monorepo root brands/
    ]:
        if candidate.exists():
            return candidate
    return here / "pipeline" / "brands"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Generate reference.docx for one or all Docgent brands."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("brand_id", nargs="?", help="Brand ID (e.g. laurion)")
    group.add_argument("--all-brands", action="store_true",
                       help="Generate for all brands with a brand.yaml")
    parser.add_argument("--brands-dir", help="Override brands directory path")
    args = parser.parse_args(argv)

    brands_dir = Path(args.brands_dir) if args.brands_dir else _resolve_brands_dir()
    if not brands_dir.exists():
        print(f"ERROR: brands directory not found: {brands_dir}", file=sys.stderr)
        sys.exit(1)

    if args.all_brands:
        brand_ids = sorted(
            d.name for d in brands_dir.iterdir()
            if d.is_dir() and (d / "brand.yaml").exists()
        )
        if not brand_ids:
            print(f"No brands found in {brands_dir}", file=sys.stderr)
            sys.exit(1)
        print(f"Generating reference.docx for {len(brand_ids)} brand(s): {', '.join(brand_ids)}")
        errors = []
        for bid in brand_ids:
            out = brands_dir / bid / "docx-reference.docx"
            try:
                generate_reference_docx(bid, brands_dir, out)
            except Exception as exc:
                print(f"  ✗ {bid}: {exc}", file=sys.stderr)
                errors.append(bid)
        if errors:
            print(f"\nFailed for: {', '.join(errors)}", file=sys.stderr)
            sys.exit(1)
    else:
        bid = args.brand_id
        out = brands_dir / bid / "docx-reference.docx"
        try:
            generate_reference_docx(bid, brands_dir, out)
        except FileNotFoundError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            sys.exit(1)
        except Exception as exc:
            print(f"ERROR generating reference.docx for '{bid}': {exc}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
