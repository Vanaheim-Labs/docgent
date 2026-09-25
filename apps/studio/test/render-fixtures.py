"""Exercise the real local render worker with synthetic, non-customer fixtures.
Run after `node apps/render-worker/stage.mjs` using worker requirements.
Artifacts are ignored under .qa/workspace; failures remain in the manifest.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys

root = Path(__file__).resolve().parents[3]
os.environ['DOCGENT_PIPELINE_DIR'] = str(root / 'apps/render-worker/pipeline')
os.environ['DOCGENT_API_KEY'] = secrets.token_hex(24)
sys.path.insert(0, str(root / 'apps/render-worker'))
spec = importlib.util.spec_from_file_location('fixture_worker', root / 'apps/render-worker/server.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
client = worker.app.test_client()
short = '---\ntitle: Workspace fixture\nbrand: vanaheim\ndoctype: report\nversion: 1\ndate: 2026-09-25\nstatus: draft\n---\n\n# Summary\n\nSynthetic fixture, not a customer document.\n'
fixtures = {
    'short': short,
    'long': short + '\n'.join(f'\n# Section {i}\n\n' + 'A reproducible long-document paragraph. ' * 50 + '\n' for i in range(1, 21)),
    'complex': short + '\n::: {.callout kind="info"}\nKeep **formatted** content and [links](https://example.invalid).\n:::\n\n::: {.datatable}\n| Metric | Value |\n| --- | --- |\n| Revenue | 42 |\n| Cost | 12 |\n:::\n\n::chart{src="figures/chart.svg" title="Synthetic chart"}\n\n::: {.pagebreak}\n:::\n\n# Appendix\n\n```text\nOpaque code stays source text.\n```\n',
}
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect x="20" y="20" width="240" height="30" fill="#1463aa"/><text x="20" y="90">Synthetic chart 42</text></svg>'
assets = {'figures/chart.svg': base64.b64encode(svg.encode()).decode()}
out = root / '.qa/workspace'
out.mkdir(parents=True, exist_ok=True)
results = []
for name, source in fixtures.items():
    (out / f'{name}.md').write_text(source)
    for endpoint, extension in [('/render/html', 'html'), ('/render', 'pdf'), ('/export/docx', 'docx')]:
        response = client.post(endpoint, json={'markdown': source, 'brand': 'vanaheim', 'assets': assets if extension != 'docx' else {}}, headers={'X-Docgent-Key': os.environ['DOCGENT_API_KEY']})
        record = {'fixture': name, 'format': extension, 'status': response.status_code, 'bytes': len(response.data), 'sha256': hashlib.sha256(response.data).hexdigest()}
        if response.status_code == 200:
            (out / f'{name}.{extension}').write_bytes(response.data)
            if extension == 'pdf': assert response.data.startswith(b'%PDF-')
            if extension == 'docx': assert response.data.startswith(b'PK')
        else:
            record['error'] = response.get_json(silent=True) or response.data[:600].decode(errors='replace')
        results.append(record)
        (out / 'render-manifest.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
sys.exit(0 if all(record['status'] == 200 for record in results) else 1)
