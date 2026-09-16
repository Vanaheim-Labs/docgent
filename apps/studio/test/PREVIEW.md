# Pre-sign-in document preview

## Design and privacy

The public document route now uses Studio's existing paper/ink tokens, typography and Docgent wordmark, with a compact two-column desktop layout. The brand palette and existing brand logo appear on a metadata-only cover. Mobile puts the title and sign-in action before the cover; the action stays above the fold at the tested widths.

This is a **cover preview**, not the document's rendered first page. It deliberately contains only the existing public frontmatter fields. No PDF, thumbnail, document source, native directive or body text is fetched by the browser. In particular, `lib/metadata.ts` no longer extracts descriptions from the source or executive summary; those could leak native-cover assets or private prose into both the visible page and social metadata. The description is now a generic sentence from type/client/status.

The store still reads the document server-side using its existing permissions. Existing metadata (title, subtitle, classification, etc.) remains public, as before; this change does not redefine the product's metadata disclosure policy.

The sign-in destination now survives both the preview link and the Google server action, including `?v=` revisions. `/signin` rejects external/protocol-relative paths and paths containing backslashes/control characters. Existing brand authorization is unchanged.

## Local verification

From the repository root:

```sh
npm ci --ignore-scripts
npm test
npm exec --workspace apps/studio -- tsc --noEmit
npm exec --workspace apps/studio -- next build
git diff --check
```

The build command intentionally avoids the prebuild brands-cloning hook. Point `DOCGENT_BRANDS_DIR` at an isolated clone of `Vanaheim-Labs/docgent-brands`. Use existing read credentials only in the local process environment, plus a temporary `AUTH_SECRET`, and bind a production proof server to loopback:

```sh
npm exec --workspace apps/studio -- next start --hostname 127.0.0.1 --port 3147
```

No OAuth or renderer credentials are needed to inspect the unauthenticated preview. `/api/health` will report degraded when no render worker is configured; use the actual document route to check this page.

`apps/studio/test/preview.test.mjs` transpiles real TypeScript modules with the existing TypeScript dependency and stubs only server I/O/auth boundaries. Regression tests were observed failing for source leakage, the missing cover, lost revision callback and discarded Google return destination before implementation. Additional characterization tests cover HTML escaping, missing metadata, unavailable documents, signed-in redirect and brand access denial.

For browser QA, load the real `/:brand/:slug` route without a session. Check 320, 390, 768 and 1440px widths, a visible keyboard focus ring, no horizontal overflow, the sign-in link, a pinned revision and an unknown document. Inspect all network resource requests: there must be no render/preview/thumbnail request. Google OAuth completion itself requires a configured local OAuth client and an authorised human account; it is not covered by the local browser proof.
