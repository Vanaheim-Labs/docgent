import { brands as loadBrands, storesFor } from "@/lib/store";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const brand = url.searchParams.get("brand") || "increm";
  const slug = url.searchParams.get("slug") || "cgt-valuation-platform-im";

  const result: Record<string, unknown> = { brand, slug };

  // Step 1: session / allowedBrands
  try {
    const session = await auth();
    if (!session) {
      result.session = "no session";
    } else {
      const user = session.user as { email?: string; allowedBrands?: string[] } | undefined;
      result.session = {
        email: user?.email ?? "(none)",
        allowedBrands: user?.allowedBrands ?? [],
        brandAllowed: (user?.allowedBrands ?? []).includes(brand),
      };
    }
  } catch (e: unknown) {
    result.sessionError = String(e);
  }

  // Step 2: brands() from disk
  try {
    result.brandsLoaded = loadBrands().map(b => b.id);
  } catch (e: unknown) {
    result.brandsError = String(e);
    return Response.json(result);
  }

  // Step 3: storesFor()
  let store: Awaited<ReturnType<typeof storesFor>> | null = null;
  try {
    store = await storesFor(brand);
    result.storesForOk = true;
  } catch (e: unknown) {
    result.storesForError = String(e);
    return Response.json(result);
  }

  // Step 4: readDocument()
  try {
    const doc = await store.docs.readDocument(brand, slug);
    result.docTitle = doc?.frontmatter?.title ?? "(no title)";
    result.docReadOk = true;
  } catch (e: unknown) {
    result.docReadError = String(e);
  }

  return Response.json(result);
}
