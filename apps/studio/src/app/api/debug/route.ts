import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const dynamic = "force-dynamic";

export async function GET() {
  const here = (() => {
    try { return dirname(fileURLToPath(import.meta.url)); }
    catch { return typeof __dirname === "string" ? __dirname : process.cwd(); }
  })();

  const candidates = [
    resolve(here, "..", "..", "brands"),
    resolve(here, "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "..", "..", "brands"),
    resolve(process.cwd(), "brands"),
    resolve(process.cwd(), "..", "..", "brands"),
  ];

  const found: Record<string, boolean | string[]> = {};
  for (const c of candidates) {
    try {
      const entries = readdirSync(c);
      found[c] = entries;
    } catch {
      found[c] = false;
    }
  }

  // Try the GitHub API fallback directly
  let githubFallback: string | object = "not attempted";
  try {
    const token = process.env.DOCGENT_BRANDS_TOKEN;
    if (token) {
      const res = await fetch(
        "https://api.github.com/repos/Vanaheim-Labs/docgent-brands/contents/increm/brand.yaml",
        { headers: { Authorization: `token ***}`, Accept: "application/vnd.github.v3+json" } }
      );
      githubFallback = { status: res.status, ok: res.ok };
    } else {
      githubFallback = "DOCGENT_BRANDS_TOKEN not set";
    }
  } catch (e: unknown) {
    githubFallback = String(e);
  }

  return Response.json({
    cwd: process.cwd(),
    here,
    candidatesChecked: found,
    githubFallback,
    env: {
      DOCGENT_BRANDS_TOKEN: !!process.env.DOCGENT_BRANDS_TOKEN,
      DOCGENT_BRANDS_WRITE_TOKEN: !!process.env.DOCGENT_BRANDS_WRITE_TOKEN,
      DOCGENT_GH_TOKEN: !!process.env.DOCGENT_GH_TOKEN,
      DOCGENT_BRANDS_REPO: process.env.DOCGENT_BRANDS_REPO ?? "(default)",
    },
  });
}
