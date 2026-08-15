import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the production Docker image can run
  // `node server.js` without the full node_modules tree (see Dockerfile runner).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Prisma's query engine and bcrypt are native; keep them out of the bundle.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;
