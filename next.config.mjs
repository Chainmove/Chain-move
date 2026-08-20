import path from "path"

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors must fail `next build`. Do not reintroduce
  // `typescript.ignoreBuildErrors` or `eslint.ignoreDuringBuilds` —
  // see docs/type-safety.md.
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@farcaster/mini-app-solana": path.resolve("lib/shims/empty-module.ts"),
    }
    return config
  },
}

export default nextConfig
