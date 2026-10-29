import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // a separate output folder lets a production build run next to `next dev` (NEXT_DIST_DIR=.next-build)
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
