import { auth } from "@/auth";
import { DraftSessionBoundary } from "@/components/DraftSessionBoundary";
import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "Docgent Studio",
  description: "Multi-brand document production",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const unified = process.env.DOCGENT_UNIFIED_WORKSPACE === "1";
  const session = unified ? await auth() : null;
  const owner = (session?.user as { draftOwner?: string } | undefined)?.draftOwner;
  return (
    <html lang="en-AU">
      <body>{unified ? <DraftSessionBoundary key={owner || "signed-out"} owner={owner}>{children}</DraftSessionBoundary> : children}</body>
    </html>
  );
}
