import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { storesFor, repoSlug } from "@/lib/store";
import { loadVocabulary } from "@/lib/vocabulary";
import { UserChip } from "@/components/UserChip";
import { Editor } from "@/components/Editor";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ brand: string; slug: string }> };

export default async function EditPage({ params }: Props) {
  const session = await auth();
  if (!session) redirect("/signin");

  const { brand, slug } = await params;

  let doc;
  try {
    const { docs } = storesFor(brand);
    doc = await docs.readDocument(brand, slug);
  } catch {
    notFound();
  }

  let vocabulary;
  try {
    vocabulary = loadVocabulary();
  } catch (e) {
    // Without the registry there is no contract to edit against, so refuse
    // rather than silently allowing anything.
    return (
      <div className="content">
        <div className="error-box">
          <strong>Vocabulary registry unavailable.</strong>
          <div style={{ marginTop: 6 }}>
            <code>{e instanceof Error ? e.message : String(e)}</code>
          </div>
        </div>
      </div>
    );
  }

  const fm = doc.frontmatter || {};

  return (
    <div className="editor-shell">
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" className="wordmark" style={{ color: "inherit" }}>
            <img src="/docgent-logo.svg" alt="Docgent" className="wordmark-logo" />
          </Link>
          <div>
            <div className="crumb">
              {repoSlug(brand)} · <strong>{brand}</strong> ·{" "}
              <Link href={`/${brand}/${slug}`}>{slug}</Link>
            </div>
            <h1 className="doc-title">{fm.title || slug}</h1>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link className="btn btn-secondary" href={`/${brand}/${slug}`}>
            Done
          </Link>
          <UserChip />
        </div>
      </div>

      <Editor
        brand={brand}
        slug={slug}
        initialContent={doc.content}
        initialSha={doc.sha ?? null}
        vocabulary={vocabulary}
      />
    </div>
  );
}
