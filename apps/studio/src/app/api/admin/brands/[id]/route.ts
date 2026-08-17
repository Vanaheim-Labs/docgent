import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBrandYamlSource, writeBrandYamlSource, brandScaffold } from "@/lib/store";

async function requireAdmin() {
  const session = await auth();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
  if (!isAdmin) return null;
  return session;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const yaml = getBrandYamlSource(id);
  if (yaml === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ id, yaml, scaffold: brandScaffold(id) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const yaml = typeof body?.yaml === "string" ? body.yaml : null;
  if (yaml === null) return NextResponse.json({ error: "yaml is required" }, { status: 400 });

  try {
    writeBrandYamlSource(id, yaml);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
