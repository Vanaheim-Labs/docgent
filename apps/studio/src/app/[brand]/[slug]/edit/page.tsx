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
    const { docs } = await storesFor(brand);
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
      <div className="editor-topbar">
        {/* Docgent icon-only logo — acts as back button to doc view */}
        <Link className="editor-logo-btn" href={`/${brand}/${slug}`} title="Back to document">
          <svg
            width="28"
            height="28"
            viewBox="0 0 275 277"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M64.9867 -0.986654C105 -0.986654 145 -1 185 -1C191.173 -0.88 197.347 0.680002 201.973 4.96C221.04 23.2133 239.04 42.6 257.893 61.0933C263.373 66.3467 264.96 73.2933 265.307 80.6267C265.28 133.96 265.333 187.293 265.293 240.627C265.213 246.133 265.72 251.173 264.48 256.6C262.32 267.68 250.987 276.733 239.667 276.067C181 275.973 122.32 276.013 63.64 276.013C54.8667 276.467 46.2134 271.333 41.7867 263.867C38.8934 259.347 38.1334 253.893 38.0134 248.627C38.0534 235.733 38.0134 222.853 38.0134 209.96C38.0534 206.093 38.44 202.413 41.6534 199.853C48.3734 194.067 58.84 199.88 57.72 208.587C57.7067 221.947 57.6534 235.307 57.72 248.667C57.4534 253 60.5734 256.28 64.96 255.987C122.667 255.92 180.693 256.067 238.4 255.907C241.573 256.053 244.12 254.213 245.44 251.413C245.933 247.88 245.707 244.2 245.72 240.627C245.693 187.787 245.747 134.893 245.693 82.0533C245.947 76.6267 242.293 74.2267 238.893 70.7333C223.133 54.4933 207.12 38.5333 191.12 22.5333C189.84 21.3733 188.867 20.16 187.093 19.8267C180.453 18.2 174.547 20.04 167.573 19.3733C159.573 18.68 151.64 19.4133 143.667 19.3067C137.4 18.7467 131.24 19.4533 125 19.5067C106.4 18.7067 87.6534 19.8133 69 19.4533C66.2934 19.6133 62.2534 18.96 60.2534 21.1867C58.0667 23.2134 57.64 25.7467 57.7067 28.6133C57.6934 57.5067 57.6934 86.4267 57.6667 115.307C57.8134 117.947 56.9467 119.547 55.16 121.413C51.92 125.533 44.9067 125.08 41.16 121.96C38.7867 119.44 37.92 116.04 38.0134 112.627C38.0534 85.52 38.0534 58.4 38 31.2933C37.9334 24.9467 38.36 17.6 41.7334 12.0267C46.32 3.47999 55.4934 -0.97332 64.9867 -0.986654Z"
              fill="var(--accent)"
            />
          </svg>
        </Link>

        {/* Breadcrumb + title stack */}
        <div className="editor-breadcrumb-stack">
          <div className="editor-breadcrumb">
            <Link href="/">{repoSlug(brand)}</Link>
            <span className="editor-breadcrumb-sep">›</span>
            <Link href={`/${brand}/${slug}`}>{fm.title || slug}</Link>
            <span className="editor-breadcrumb-sep">›</span>
            <span className="editor-breadcrumb-current">Editing</span>
          </div>
          <h1 className="editor-doc-title">{fm.title || slug}</h1>
        </div>

        {/* Right side — user chip only */}
        <div className="editor-topbar-right">
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
