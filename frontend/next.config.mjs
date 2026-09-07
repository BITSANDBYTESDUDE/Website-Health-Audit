/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // In development the Next.js server proxies API calls to the backend so
    // browser code never needs to know where the API lives.
    const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8787';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/reports/:path*', destination: `${backend}/reports/:path*` },
    ];
  },
};

export default nextConfig;
