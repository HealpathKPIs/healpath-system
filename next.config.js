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
  // The capacity schema route reads its migration from disk to install it.
  // Without this the .sql file is traced out of the serverless bundle and the
  // route fails at runtime with "could not read" rather than at build time.
  outputFileTracingIncludes: {
    '/api/capacity/schema': ['./supabase/migrations/*.sql'],
  },
};
module.exports = nextConfig;
