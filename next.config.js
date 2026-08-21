/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, encoding: false };
    return config;
  },
};
module.exports = nextConfig;
