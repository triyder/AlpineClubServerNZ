import type { Metadata } from "next";
import "./globals.css";
import { AppThemeProvider } from "@/components/theme-provider";

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
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}
