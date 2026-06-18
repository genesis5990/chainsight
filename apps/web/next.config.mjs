/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // for Fly.io Docker deployment
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
};

export default nextConfig;
