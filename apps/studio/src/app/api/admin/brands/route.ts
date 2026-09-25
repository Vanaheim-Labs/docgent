import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { allBrandIds, brands, createBrand } from "@/lib/store";

/**
 * Route-level isAdmin check in addition to middleware's guardAdminPath.
 * Middleware already blocks non-admins from ever reaching this handler in
 * production, but relying on that alone would make this route silently
 * unsafe if the matcher in middleware.ts is ever narrowed — checking again
 * here costs nothing and fails closed independently.
 */
async function requireAdmin() {
  const session = await auth();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
  if (!isAdmin) return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const configured = new Map(brands().map((b) => [b.id, b]));
  const ids = allBrandIds();
  const list = ids.map((id) => ({
    id,
    name: configured.get(id)?.name ?? id,
    // A brand directory can exist with a brand.yaml but no repo: field yet
    // (mid-setup) — configured tracks whether it's actually usable by the
    // rest of Studio (brands(), which requires repo:), not just present.
    configured: configured.has(id),
  }));

  return NextResponse.json({ brands: list });
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const name = typeof body?.name === "string" ? body.name : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    createBrand(id, name);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
