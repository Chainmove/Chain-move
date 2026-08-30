import path from "path"

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors must fail `next build`. Do not reintroduce
  // `typescript.ignoreBuildErrors` or `eslint.ignoreDuringBuilds` —
  // see docs/type-safety.md.
  images: {
    unoptimized: true,
  },
  webpack: (config, { webpack }) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@farcaster/mini-app-solana": path.resolve("lib/shims/empty-module.ts"),
      "@solana-program/token-2022": path.resolve("lib/shims/solana-token-2022-shim.ts"),
    }
    config.plugins = config.plugins || []
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /@lit_reactive-element@2\.0\.4\/node_modules\/@lit\/reactive-element/,
        (resource) => {
          const match = resource.request.match(
            /@lit_reactive-element@2\.0\.4\/node_modules\/@lit\/reactive-element\/(.*)/,
          )
          if (match && match[1]) {
            const fileWithJs = match[1].replace(/\.mjs$/, ".js")
            resource.request = path.resolve("node_modules/@lit/reactive-element", fileWithJs)
          }
        },
      ),
    )
    return config
  },
}

export default nextConfig
