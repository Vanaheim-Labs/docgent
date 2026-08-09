import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The monorepo root — brands/ and packages/ live here, outside apps/studio.
const repoRoot = path.resolve(__dirname, "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Studio reads the repo through the GitHub API at request time; nothing is
  // prerendered from repo content, so no build-time GitHub access is needed.
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },

  // brand.yaml is read from disk at request time (src/lib/store.ts), but the
  // path is computed at runtime so Next's static tracing cannot see it. Without
  // this the brands/ directory is absent from the serverless bundle: brands()
  // returns [], every findBrand() misses, and every document 404s while the
  // listing still renders because it swallows per-brand errors.
  //
  // Tracing is rooted at the monorepo so files outside apps/studio are eligible.
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/**": ["../../brands/**/brand.yaml"],
  },
};

export default nextConfig;
