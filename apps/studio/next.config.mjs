/** @type {import('next').NextConfig} */
const nextConfig = {
  // Studio reads the repo through the GitHub API at request time; nothing is
  // prerendered from repo content, so no build-time GitHub access is needed.
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
