import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AppThemeProvider } from "@/components/theme-provider";
import { PublicThemeCorner } from "@/components/public-theme-corner";

export const metadata: Metadata = {
  title: "AlpineClubServerNZ",
  description:
    "Central hub connecting AlpineClubBookingsNZ installations — API access and administrative oversight.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The proxy's per-request CSP nonce, for the one inline script this app
  // writes itself (next-themes' no-flash theme script). Reading headers also
  // renders every page per request, which a nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppThemeProvider nonce={nonce}>
          <PublicThemeCorner />
          {children}
        </AppThemeProvider>
      </body>
    </html>
  );
}
