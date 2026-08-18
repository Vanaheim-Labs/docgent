import { brands as loadBrands, storesFor } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const brand = url.searchParams.get("brand") || "increm";
  const slug = url.searchParams.get("slug") || "cgt-valuation-platform-im";

  const result: Record<string, unknown> = {
    brand,
    slug,
    step: "starting",
  };

  // Step 1: brands() — disk read
  try {
    const bs = loadBrands();
    result.brandsLoaded = bs.map(b => ({ id: b.id, repo: b.repo }));
    result.step = "brands() ok";
  } catch (e: unknown) {
    result.brandsError = String(e);
    return Response.json(result);
  }

  // Step 2: storesFor()
  let store: Awaited<ReturnType<typeof storesFor>> | null = null;
  try {
    store = await storesFor(brand);
    result.storesForOk = true;
    result.brandRepo = store.brand.repo;
    result.step = "storesFor() ok";
  } catch (e: unknown) {
    result.storesForError = String(e);
    return Response.json(result);
  }

  // Step 3: actual doc read
  try {
    const doc = await store.docs.readDocument(brand, slug);
    result.docRead = true;
    result.docTitle = doc?.frontmatter?.title ?? "(no title)";
    result.step = "readDocument() ok";
  } catch (e: unknown) {
    result.docReadError = String(e);
    result.step = "readDocument() FAILED";
  }

  return Response.json(result);
}
