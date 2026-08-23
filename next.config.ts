import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
