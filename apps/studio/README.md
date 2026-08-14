# Docgent Studio

Read-only web UI over the git-backed document store (Phase 4).

Studio is a git client, not a CMS. It reads documents through the GitHub API
via `packages/git-store`, and renders PDFs through the Phase 2 worker. It
holds no database and no document state of its own.

## What it does

- GitHub OAuth, restricted to members of one org
- Document tree grouped by brand
- Rendered PDF preview, live from the render worker
- Frontmatter metadata panel with status/classification badges
- Version timeline from git history; click any version to render it

Editing lands in Phase 5.

## Why PDFs are not rendered here

Vercel cannot run WeasyPrint (Python plus native Pango/Cairo/HarfBuzz).
Every render goes through the worker, which also guarantees the PDF a human
previews is byte-identical to the one an agent produces from the CLI.

## Environment

See `.env.example`. `DOCGENT_GH_TOKEN` is used for all repo access rather
than the signed-in user's token, so permissions are governed by org
membership rather than by whatever scopes an individual granted.

## Local development

```bash
cd apps/studio
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

## Deployment

Vercel, root directory `apps/studio`. Set every variable from `.env.example`
in project settings. The GitHub OAuth app callback URL must be
`https://<domain>/api/auth/callback/github`.
