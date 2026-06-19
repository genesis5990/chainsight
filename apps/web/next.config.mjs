/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // for Fly.io Docker deployment
  // Next.js needs to transpile our workspace packages (their `main` points
  // directly at .ts source so Next must run them through SWC).
  transpilePackages: ['@chainsight/shared-types'],
  // Standalone output must include the monorepo's pnpm node_modules.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
};

export default nextConfig;
