import { auth } from "@/auth";
import Link from "next/link";
import { UserChip } from "@/components/UserChip";
import { BrandList } from "@/components/admin/BrandList";
import { allBrandIds, brands } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Server-rendered initial list (same allBrandIds()/brands() the API route
 * uses) so the page has content on first paint without a client-side
 * fetch waterfall; BrandList still owns the create-brand interaction and
 * re-fetches after a create, since that part is inherently interactive.
 */
export default async function AdminBrandsPage() {
  await auth(); // Presence already enforced by middleware; this is just to read session data below if needed later.

  const configured = new Map(brands().map((b) => [b.id, b]));
  const ids = allBrandIds();
  const initialBrands = ids.map((id) => ({
    id,
    name: configured.get(id)?.name ?? id,
    configured: configured.has(id),
  }));

  return (
    <div className="shell">
      <div className="main">
        <div className="topbar">
          <div>
            <div className="crumb">
              <Link href="/admin">Admin</Link> / Brands
            </div>
            <h1 className="doc-title">Brands</h1>
          </div>
          <UserChip />
        </div>
        <div className="content">
          <BrandList initialBrands={initialBrands} />
        </div>
      </div>
    </div>
  );
}
