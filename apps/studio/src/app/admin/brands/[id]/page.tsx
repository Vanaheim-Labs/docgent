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
          <BrandEditor brandId={id} initialYaml={yaml} scaffold={scaffold} />
        </div>
      </div>
    </div>
  );
}
