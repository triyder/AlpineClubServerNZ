import type { NextConfig } from "next";

/**
 * Content-Security-Policy for production. Everything this app loads is its
 * own (images come through /api/images and /_next/image, no third-party
 * scripts, fonts or APIs), so `'self'` covers it. Next's App Router writes
 * inline bootstrap scripts, hence `'unsafe-inline'` for scripts until the
 * pages move to per-request nonces; the policy still blocks every script,
 * frame, plugin and form target from another origin. Not applied in dev,
 * where React Refresh needs `eval`.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY }],
      },
    ];
  },
  // Emit a self-contained server bundle so the production Docker image can run
  // `node server.js` without the full node_modules tree (see Dockerfile runner).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Prisma's query engine, bcrypt and sharp are native; keep them out of
  // the bundle so the standalone build loads them from node_modules.
  serverExternalPackages: ["@prisma/client", "bcryptjs", "sharp"],
};

export default nextConfig;
