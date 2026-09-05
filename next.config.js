const assetHost = process.env.NEXT_PUBLIC_IMAGE_ASSET_HOST || 'https://images.om-recipes.com';

let assetRemotePattern = null;

try {
  const assetUrl = new URL(assetHost);
  assetRemotePattern = {
    protocol: assetUrl.protocol.replace(':', ''),
    hostname: assetUrl.hostname,
    pathname: '/**',
  };

  if (assetUrl.port) {
    assetRemotePattern.port = assetUrl.port;
  }
} catch {
  assetRemotePattern = {
    protocol: 'https',
    hostname: 'images.om-recipes.com',
    pathname: '/**',
  };
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // TEMPORARY: disabled to check whether double-firing effects in dev
  // (Strict Mode's intentional double-invoke) explain the duplicate
  // saved_recipes/catalog queries on page load. Revert after checking.
  reactStrictMode: false,
  reactCompiler: true,

  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [assetRemotePattern],
  },

  experimental: {
    proxyClientMaxBodySize: '20mb',
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
};

export default nextConfig;
