import { safeNextPath } from "@/lib/safe-next-path";
import { LoginForm } from "./login-form";

/**
 * Sign-in. A server component only to read `?next=` (set by the proxy when a
 * signed-out visitor opens a console page) without a client-side Suspense
 * boundary; the form itself is the client component beside it.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}
