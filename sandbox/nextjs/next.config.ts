import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Import Ferry's TS source (../../src, aliased to `ferry` in tsconfig) from
  // outside this app's directory.
  experimental: { externalDir: true },
  // Pin the workspace root so Next doesn't warn about the repo-root lockfile
  // it finds while walking up.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
