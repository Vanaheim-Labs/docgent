"""Native cover integration tests; requires pandoc and the render-worker deps."""
import importlib.util
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
FILTER = ROOT / 'packages/core/filters/vocabulary.lua'


def html(markdown):
    return subprocess.run(['pandoc', '-f', 'markdown', '-t', 'html5',
                           '--lua-filter', str(FILTER)], input=markdown,
                          text=True, capture_output=True, check=True).stdout


def test_native_cover_is_semantic_and_escapes_attribute_text():
    result = html('''::: {.native-cover eyebrow="BUSINESS PLAN" subtitle="An introduction" metric="2.6M" statement="Australians need advice." demand="$1.2–$2.3 billion" source="A & B < C" partner="TIFIN.AI (USA)" licence="Exclusive Australian licence" version="V37 · CONFIDENTIAL"}
Exact **legal** wording.
:::
''')
    assert '<section class="native-cover" aria-label="Document cover">' in result
    assert '<div class="native-cover-subtitle">An introduction</div>' in result
    assert 'A &amp; B &lt; C' in result
    assert '<footer class="native-cover-footer">' in result
    assert '<p>Exact <strong>legal</strong> wording.</p>' in result
    assert '2.6M' in result


def worker():
    spec = importlib.util.spec_from_file_location('worker', ROOT / 'apps/render-worker/server.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.FILTER = FILTER
    module.MICROTYPE_FILTER = ROOT / 'packages/core/filters/microtype.lua'
    module.BASE_CSS = ROOT / 'packages/core/css/base.css'
    module.TEMPLATE = ROOT / 'packages/core/templates/document.html'
    return module


def test_cover_occupies_one_page_with_anchored_extractable_legal(tmp_path):
    import pymupdf
    from weasyprint import HTML
    w = worker()
    brand = {'id': 'test', '_dir': str(tmp_path), 'name': 'Test'}
    md = '''---
title: Test
nocover: true
---
::native-cover{subtitle="An introduction" metric="2.6M" statement="Australians need advice." version="V37 · CONFIDENTIAL"}
This document is strictly confidential and intended solely for the named recipient.
::

# Contents

Body starts here.
'''
    staged, sheets = w._stage(tmp_path, md, brand, {}, None)
    target = tmp_path / 'doc.html'
    w._run_pandoc(staged, target, brand, 'test', {}, sheets, False)
    pdf = pymupdf.open(stream=HTML(filename=str(target)).write_pdf())
    assert len(pdf) == 2
    assert 'Body starts here.' not in pdf[0].get_text()
    assert 'Body starts here.' in pdf[1].get_text()
    legal = pdf[0].search_for('This document is strictly confidential')
    assert legal and legal[0].y0 > 650
    assert pdf[0].rect.width > 590


def test_native_cover_is_registered_with_documented_attributes():
    import re
    registry = (ROOT / 'packages/vocabulary/vocabulary.yaml').read_text()
    assert '    - nocover\n' in registry, 'Opt-in must be a documented frontmatter option'
    match = re.search(r'  - id: native-cover\n(.*?)(?=\n  - id:|\Z)', registry, re.S)
    assert match, 'native-cover is missing from the registry'
    assert set(re.findall(r'^      ([\w-]+):', match[1], re.M)) == {
        'logo', 'logo-alt', 'eyebrow', 'subtitle', 'insight-label', 'metric',
        'statement', 'demand', 'source', 'partner', 'licence', 'version'}


def test_opt_in_example_passes_the_real_vocabulary_validator(tmp_path):
    example = tmp_path / 'cover.md'
    example.write_text('''---
title: Example
brand: laurion
doctype: Business Plan
version: v1
date: September 2026
nocover: true
---
::: {.native-cover subtitle="An introduction"}
Legal text.
:::
''')
    result = subprocess.run(['node', str(ROOT / 'packages/vocabulary/src/validate.mjs'), str(example)], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
