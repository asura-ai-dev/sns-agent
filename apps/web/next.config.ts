import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sns-agent/ui", "@sns-agent/sdk", "@sns-agent/config"],
};

export default nextConfig;
