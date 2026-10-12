import type { Metadata } from "next";
import "./globals.css";
import { AppThemeProvider } from "@/components/theme-provider";
import { PublicThemeCorner } from "@/components/public-theme-corner";

export const metadata: Metadata = {
  title: "AlpineClubServerNZ",
  description:
    "Central hub connecting AlpineClubBookingsNZ installations — API access and administrative oversight.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppThemeProvider>
          <PublicThemeCorner />
          {children}
        </AppThemeProvider>
      </body>
    </html>
  );
}
