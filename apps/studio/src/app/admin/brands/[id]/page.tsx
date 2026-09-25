import { notFound } from "next/navigation";
import Link from "next/link";
import { UserChip } from "@/components/UserChip";
import { BrandEditor } from "@/components/admin/BrandEditor";
import { getBrandYamlSource, brandScaffold } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminBrandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const yaml = getBrandYamlSource(id);
  if (yaml === null) notFound();

  const scaffold = brandScaffold(id);

  // Read the agent token server-side — only visible to the admin, never
  // exposed to the client until they explicitly hit "Reveal" in the editor.
  const agentToken = process.env["DOCGENT_AGENT_TOKEN_" + id.toUpperCase()] ?? null;

  return (
    <div className="shell">
      <div className="main">
        <div className="topbar">
          <div>
            <div className="crumb">
              <Link href="/admin">Admin</Link> / <Link href="/admin/brands">Brands</Link> / {id}
            </div>
            <h1 className="doc-title">{id}</h1>
          </div>
          <UserChip />
        </div>
        <div className="content">
          <BrandEditor brandId={id} initialYaml={yaml} scaffold={scaffold} agentToken={agentToken} />
        </div>
      </div>
    </div>
  );
}
