"use client";

import { ThemeProvider } from "next-themes";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isPublicPath } from "@/lib/public-pages";

/** localStorage key for the console's persisted UI theme choice. */
export const UI_THEME_STORAGE_KEY = "acs-ui-theme";

/**
 * localStorage key for the PUBLIC pages' theme (home, sign-in, register and the
 * lodge search). Separate from the console's, so a guest's choice and an
 * operator's choice never overwrite each other, and so the public default can
 * differ: light, whatever the device prefers.
 */
export const PUBLIC_THEME_STORAGE_KEY = "acs-public-theme";

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const isPublic = isPublicPath(usePathname() ?? "/");

  // Keyed by area: next-themes reads its stored choice once, on mount, so
  // crossing between the public pages and the console remounts the provider
  // to pick up the other area's choice and default.
  return isPublic ? (
    <ThemeProvider
      key="public"
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      enableColorScheme
      disableTransitionOnChange
      storageKey={PUBLIC_THEME_STORAGE_KEY}
    >
      {children}
    </ThemeProvider>
  ) : (
    <ThemeProvider
      key="console"
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
      storageKey={UI_THEME_STORAGE_KEY}
    >
      {children}
    </ThemeProvider>
  );
}
