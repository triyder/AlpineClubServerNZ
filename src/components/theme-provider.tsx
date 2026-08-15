"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/** localStorage key for the persisted UI theme choice. */
export const UI_THEME_STORAGE_KEY = "acs-ui-theme";

export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
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
