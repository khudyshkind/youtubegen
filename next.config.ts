import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Include the font file in the serverless function bundle for /api/generate/thumbnail
  outputFileTracingIncludes: {
    '/api/generate/thumbnail': ['./public/fonts/Montserrat-Black.ttf'],
  },
};

export default nextConfig;
