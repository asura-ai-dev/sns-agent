import type { NextConfig } from "next";

const apiUrl = process.env.API_URL || "http://localhost:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@sns-agent/ui", "@sns-agent/sdk", "@sns-agent/config"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
