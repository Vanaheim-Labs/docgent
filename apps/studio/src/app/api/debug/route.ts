import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brands as loadBrands } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Simulate exactly what store.ts does
  const here = (() => {
    try { return dirname(fileURLToPath(import.meta.url)); }
    catch { return typeof __dirname === "string" ? __dirname : process.cwd(); }
  })();

  const storeHere = (() => {
    // store.ts is at src/lib/store.ts — same depth resolution but different __dirname
    // We can infer by checking what BRANDS_DIR resolves to
    return "(check brandList below)";
  })();

  const candidates = [
    resolve(here, "..", "..", "brands"),
    resolve(here, "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "..", "..", "brands"),
    join(process.cwd(), "brands"),
    join(process.cwd(), "..", "brands"),
    join(process.cwd(), "..", "..", "brands"),
    "/var/task/brands",
  ];

  const found: Record<string, string[] | false> = {};
  for (const c of candidates) {
    try { found[c] = readdirSync(c); }
    catch { found[c] = false; }
  }

  // Call brands() from store.ts directly to see what it actually returns
  let brandList: string[] = [];
  let brandError = "";
  try {
    brandList = loadBrands().map(b => b.id);
  } catch (e: unknown) {
    brandError = String(e);
  }

  return Response.json({
    cwd: process.cwd(),
    debugHere: here,
    storeHere,
    candidatesFromDebugHere: found,
    brandList,
    brandError,
  });
}
