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
            height="29"
            viewBox="0 0 266 278"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M64.8834 0.0133464C104.897 0.0133464 144.897 0 184.897 0C191.07 0.12 197.243 1.68 201.87 5.96C220.937 24.2133 238.937 43.6 257.79 62.0933C263.27 67.3467 264.857 74.2933 265.203 81.6267C265.177 134.96 265.23 188.293 265.19 241.627C265.11 247.133 265.617 252.173 264.377 257.6C262.217 268.68 250.883 277.733 239.563 277.067C180.897 276.973 122.217 277.013 63.5368 277.013C54.7634 277.467 46.1101 272.333 41.6834 264.867C38.7901 260.347 38.0301 254.893 37.9101 249.627C37.9501 236.733 37.9101 223.853 37.9101 210.96C37.9501 207.093 38.3368 203.413 41.5501 200.853C48.2701 195.067 58.7368 200.88 57.6168 209.587C57.6034 222.947 57.5501 236.307 57.6168 249.667C57.3501 254 60.4701 257.28 64.8568 256.987C122.563 256.92 180.59 257.067 238.297 256.907C241.47 257.053 244.017 255.213 245.337 252.413C245.83 248.88 245.603 245.2 245.617 241.627C245.59 188.787 245.643 135.893 245.59 83.0533C245.843 77.6267 242.19 75.2267 238.79 71.7333C223.03 55.4933 207.017 39.5333 191.017 23.5333C189.737 22.3733 188.763 21.16 186.99 20.8267C180.35 19.2 174.443 21.04 167.47 20.3733C159.47 19.68 151.537 20.4133 143.563 20.3067C137.297 19.7467 131.137 20.4533 124.897 20.5067C106.297 19.7067 87.5501 20.8133 68.8968 20.4533C66.1901 20.6133 62.1501 19.96 60.1501 22.1867C57.9634 24.2134 57.5368 26.7467 57.6034 29.6133C57.5901 58.5067 57.5901 87.4267 57.5634 116.307C57.7101 118.947 56.8434 120.547 55.0568 122.413C51.8168 126.533 44.8034 126.08 41.0568 122.96C38.6834 120.44 37.8168 117.04 37.9101 113.627C37.9501 86.52 37.9501 59.4 37.8968 32.2933C37.8301 25.9467 38.2568 18.6 41.6301 13.0267C46.2168 4.47999 55.3901 0.0266797 64.8834 0.0133464Z" fill="#001839"/>
            <path d="M218.017 109.6C219.404 121.187 207.004 131.52 195.937 127.88C191.364 126.587 188.35 123.387 186.044 119.387C174.55 118.96 163.03 119.333 151.537 119.187C147.404 119.093 143.724 119.587 140.817 122.827C129.27 134.627 117.537 146.187 106.204 158.187C100.764 154.28 95.4969 152.773 88.8569 152.173C92.4036 150.413 94.7636 147.64 97.5236 144.92C108.804 133.52 120.097 122.107 131.11 110.44C136.004 105.387 143.31 103.413 150.177 103.573C161.804 103.6 173.43 103.627 185.057 103.48C187.67 99.0668 190.777 95.4934 195.83 93.9067C206.23 90.4401 217.87 98.6001 218.017 109.6Z" fill="#001839"/>
            <path d="M19.6571 144.627C24.3504 145.253 27.0037 148.373 29.7637 151.867C45.4437 152.467 61.2571 151.32 76.8971 152.547C80.8704 152.707 84.8437 152.213 88.8571 152.173C95.4971 152.773 100.764 154.28 106.204 158.187C111.99 163.213 117.084 169.293 122.524 174.667C129.59 181.28 136.03 188.813 143.59 195.147C146.017 196.32 148.91 196.507 151.55 196.56C162.75 196.6 173.964 196.573 185.164 196.48C187.204 193.547 189.017 190.747 192.204 188.893C199.75 184.28 210.47 186.507 215.15 194.133C217.924 198.867 219.59 205.093 217.257 210.333C214.23 219.493 203.017 224.827 194.124 220.827C189.644 219.187 187.724 215.573 184.99 212C171.63 212 158.23 212.027 144.87 211.933C139.497 211.987 134.47 208.76 130.817 205.04C120.364 194.587 109.857 184.213 99.4704 173.707C96.7504 171.093 94.3104 168.64 90.2571 168.667C70.4571 168.52 50.5904 168.493 30.7771 168.68C29.1104 170.68 27.6171 172.64 25.4837 174.2C19.5104 178.827 9.97707 177.747 4.7504 172.427C0.337066 168.467 -0.556276 162.147 0.283724 156.533C2.05706 148.08 11.3371 142.56 19.6571 144.627Z" fill="#0D6EFA"/>
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
