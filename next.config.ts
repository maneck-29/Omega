import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project sits inside a parent directory that also contains a checkout,
  // so Next.js finds a second package-lock.json above the repo and warns that it
  // is ignoring it. Pinning the tracing root to this package keeps the
  // dependency trace (and therefore the deploy bundle) correct.
  outputFileTracingRoot: path.resolve(import.meta.dirname),

  images: {
    // Omega does not support Next.js image optimisation — /_next/image returns
    // 404 there. Serving images as-is keeps them working in both environments.
    unoptimized: true,
  },
  // PGlite ships a WASM build used only by the local dev fallback. Marking it
  // external keeps the bundler from trying to inline the binary.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
