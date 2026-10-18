/**
 * The pages anyone can open without signing in. One list, read by the proxy
 * coverage test (every OTHER page must be session-gated) and by the theme
 * provider (these pages have their own theme setting, light by default).
 *
 * `/book` is the public bed planner (#25); its "Book with the club" redirect
 * (`/book/go/:id`) is a route handler, not a page, but sits under the same
 * prefix.
 */
export const PUBLIC_PAGES = ["/", "/login", "/register", "/book"] as const;

/** True for a public page or anything beneath one (other than under `/`). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PAGES.some((page) =>
    page === "/" ? pathname === "/" : pathname === page || pathname.startsWith(`${page}/`),
  );
}
