# Docgent render worker

pandoc + WeasyPrint behind an HTTP API. This is the single source of render
truth — Studio and the CLI both call it, so a document renders identically
regardless of who asked.

WeasyPrint needs Python plus native Pango/Cairo/HarfBuzz, which is exactly why
this cannot run on Vercel.

## API

\`POST /render\` — \`X-Docgent-Key: <secret>\`

\`\`\`json
{
  "markdown": "---\ntitle: ...\n---\n# Body",
  "brand": "vanaheim",
  "assets": { "assets/chart.svg": "<base64>" },
  "filename": "report.pdf"
}
\`\`\`

Returns \`application/pdf\`. Response headers carry \`X-Docgent-Request-Id\`
and \`X-Docgent-Render-Ms\`.

\`GET /health\` — unauthenticated. Reports binary/asset presence and known brands.
\`GET /brands\` — authenticated. Lists brand ids and display names.

Errors: 400 bad request · 401 unauthorised · 404 unknown brand ·
413 payload too large · 422 pandoc/WeasyPrint failure · 504 timeout.

## Deploy

\`\`\`bash
node apps/render-worker/stage.mjs          # copy pipeline assets into build context
fly launch --no-deploy                     # first time only
fly secrets set DOCGENT_API_KEY=$(openssl rand -hex 32)
fly deploy
\`\`\`

Re-run \`stage.mjs\` and redeploy whenever base CSS, templates, filters, or
brand definitions change — the image embeds them.

## Fonts

Drop brand font files into \`apps/render-worker/fonts/\`; the image runs
\`fc-cache\` over them at build time. Do not rely on host fonts — that is how a
PDF looks right locally and wrong in production. Check licensing permits
embedding and server-side rendering before committing font binaries.

## Local development

\`\`\`bash
cd apps/render-worker
node stage.mjs
DOCGENT_PIPELINE_DIR=./pipeline DOCGENT_API_KEY=dev python3 server.py
\`\`\`
