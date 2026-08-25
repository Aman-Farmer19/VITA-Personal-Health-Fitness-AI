/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // ── Optimize heavy package imports ────────────────────────────────
  experimental: {
    optimizePackageImports: ['three'],
  },

  webpack: (config, { isServer }) => {
    // ── Fix face-api.js trying to use Node fs in browser ─────────────
    // This alone removes ~200 warning lines and speeds up compilation
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        buffer: false,
      };
    }

    config.resolve.alias = {
      ...config.resolve.alias,
      encoding: false,
    };

    return config;
  },
};

module.exports = nextConfig;