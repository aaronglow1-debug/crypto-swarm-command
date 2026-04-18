/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow streaming responses from API routes
  experimental: {
    serverComponentsExternalPackages: ['@anthropic-ai/sdk'],
  },
}

module.exports = nextConfig

// trigger deploy
