"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
] as const;

type ThemeOption = (typeof themeOptions)[number]["value"];

/** Segmented Light / Dark / System control (used on the Profile page). */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const activeTheme: ThemeOption =
    mounted && (theme === "light" || theme === "dark" || theme === "system")
      ? theme
      : "system";

  // next-themes only knows the resolved theme after mount; render a stable
  // default first to avoid a hydration mismatch. The one-shot mount flag is the
  // canonical pattern here, so the set-state-in-effect rule is not a concern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  return (
    <div
      aria-label="Theme"
      role="radiogroup"
      className={cn(
        "grid grid-cols-3 gap-1 rounded-md border border-border bg-muted p-1",
        className,
      )}
    >
      {themeOptions.map(({ value, label, icon: Icon }) => {
        const active = activeTheme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              "flex min-h-10 flex-col items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-medium leading-tight text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "bg-background shadow-sm",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Compact single-button toggle (used in the console header). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      title={isDark ? "Switch to light" : "Switch to dark"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {/* Render both and let CSS/JS pick to avoid a hydration flash. */}
      {mounted ? (
        isDark ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
