import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ferry (file:../..) symlinks to the repo root, which itself contains this
  // sandbox — pin the workspace root so Next doesn't get confused by the
  // extra bun.lock it finds while walking up from that symlink.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
