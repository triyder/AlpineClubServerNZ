"use client";

import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-switcher";
import { isPublicPath } from "@/lib/public-pages";

/**
 * The light/dark toggle on the public pages, fixed to the top-right corner.
 * The console has its own toggle in its header, so this renders nothing there.
 */
export function PublicThemeCorner() {
  if (!isPublicPath(usePathname() ?? "/")) return null;
  return (
    <div className="fixed right-4 top-4 z-40">
      <ThemeToggle className="bg-background" />
    </div>
  );
}
