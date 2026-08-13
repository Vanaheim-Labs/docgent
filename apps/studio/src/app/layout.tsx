import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Docgent Studio",
  description: "Multi-brand document production",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
