import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Visible build stamp (header chip) so a stale PWA instance is
    // detectable at a glance. COMMIT_REF is provided by Netlify builds.
    NEXT_PUBLIC_BUILD_SHA: (process.env.COMMIT_REF ?? "local").slice(0, 7),
  },
};

export default nextConfig;
