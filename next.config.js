/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['pg'],
    // Client-side Router Cache off. By default Next.js 14 reuses an already
    // rendered route for 30s, so navigating back to a dashboard after an import
    // (or after changing a filter) could show pre-import KPI cards and charts
    // until a hard refresh. Every page here is a live database read, so a
    // navigation must always re-fetch.
    staleTimes: { dynamic: 0, static: 0 },
  },
};
module.exports = nextConfig;
