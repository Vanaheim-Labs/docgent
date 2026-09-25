import type { CSSProperties } from "react";
import type { DocPreviewMeta } from "@/lib/metadata";
import { getBrandTheme } from "@/lib/brand-theme";
import "./SignInPreview.css";

/** Server-rendered cover composed ONLY of the public metadata allowlist.
 * Not a PDF thumbnail: no protected body, source directives or render request
 * is sent to the browser, even under the decorative page treatment. */
export async function SignInPreview({ meta, brand, slug, commitSha }: {
  meta: DocPreviewMeta;
  brand: string;
  slug: string;
  commitSha?: string;
}) {
  const theme = await getBrandTheme(brand, true);
  const returnTo = `/${encodeURIComponent(brand)}/${encodeURIComponent(slug)}` +
    (commitSha ? `?v=${encodeURIComponent(commitSha)}` : "");
  const details = [
    ["Version", meta.version], ["Date", meta.date],
    ["Prepared for", meta.client], ["Author", meta.author],
  ].filter(([, value]) => value);

  return (
    <div className="signin-preview" style={{
      "--preview-band": theme.palette.band,
      "--preview-accent": theme.palette.accent,
      "--preview-band-ink": theme.darkBand ? "#ffffff" : "#12161c",
    } as CSSProperties}>
      <header className="preview-topbar">
        <a href="/" aria-label="Docgent Studio"><img src="/docgent-logo.svg" alt="Docgent" /></a>
        <span>Document preview</span>
      </header>

      <main className="preview-main">
        <section className="preview-intro" aria-labelledby="preview-title">
          <div className="preview-eyebrow">{meta.brandName} <span aria-hidden="true">/</span> {meta.doctype || "Document"}</div>
          <div className="preview-badges">
            {meta.status && <span className="preview-status">{meta.status}</span>}
            {meta.classification && <span className="preview-classification">{meta.classification}</span>}
          </div>
          <h1 id="preview-title">{meta.title}</h1>
          {meta.subtitle && <p className="preview-subtitle">{meta.subtitle}</p>}
          {details.length > 0 && <dl className="preview-details">
            {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>}
          <div className="preview-access">
            <h2>Your document is ready to view.</h2>
            <p>Sign in with an authorised account to open the full document.</p>
            <a className="preview-cta" href={`/signin?callbackUrl=${encodeURIComponent(returnTo)}`}>
              Sign in to view document <span aria-hidden="true">→</span>
            </a>
            <p className="preview-help">Access is managed by {meta.brandName}.</p>
          </div>
        </section>

        <figure className="preview-figure" aria-labelledby="preview-caption">
          <div className="preview-stage">
            <div className="preview-cover" aria-hidden="true">
              <div className="preview-cover-brand">
                {theme.logoDataUri ? <img src={theme.logoDataUri} alt="" /> : <span>{meta.brandName}</span>}
              </div>
              <div className="preview-cover-rule" />
              <div className="preview-cover-type">{meta.doctype || "Document"}</div>
              <div className="preview-cover-title">{meta.title}</div>
              {meta.subtitle && <div className="preview-cover-subtitle">{meta.subtitle}</div>}
              <div className="preview-cover-footer">
                <span>{[meta.version, meta.date].filter(Boolean).join(" · ")}</span>
                {meta.classification && <span>{meta.classification}</span>}
              </div>
            </div>
          </div>
          <figcaption id="preview-caption"><strong>Cover preview</strong><span>Document content is available after sign-in.</span></figcaption>
        </figure>
      </main>
      <footer className="preview-footer"><span>Shared with Docgent</span><span>Documents, thoughtfully delivered.</span></footer>
    </div>
  );
}
