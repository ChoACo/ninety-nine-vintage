import type { NextConfig } from "next";

const supabaseImageHostname = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  // Keep the App Router in its default SSR mode. Product images use next/image;
  // the allow-list below limits remote optimization to Supabase Storage while
  // AVIF/WebP variants and device-specific srcsets reduce storefront payloads.
  // PortOne's public VITE_* names are retained for deployment compatibility;
  // Next exposes the same values to the client bundle through this explicit
  // mapping instead of relying on Vite's import.meta.env transform.
  env: {
    VITE_PORTONE_STORE_ID: process.env.VITE_PORTONE_STORE_ID,
    VITE_PORTONE_CHANNEL_KEY: process.env.VITE_PORTONE_CHANNEL_KEY,
    VITE_PORTONE_CARD_CHANNEL_KEY: process.env.VITE_PORTONE_CARD_CHANNEL_KEY,
    VITE_PORTONE_KAKAOPAY_CHANNEL_KEY:
      process.env.VITE_PORTONE_KAKAOPAY_CHANNEL_KEY,
    VITE_PORTONE_VIRTUAL_ACCOUNT_CHANNEL_KEY:
      process.env.VITE_PORTONE_VIRTUAL_ACCOUNT_CHANNEL_KEY,
    VITE_PORTONE_WEBHOOK_URL: process.env.VITE_PORTONE_WEBHOOK_URL,
    NEXT_PUBLIC_PORTONE_WEBHOOK_URL:
      process.env.NEXT_PUBLIC_PORTONE_WEBHOOK_URL ??
      process.env.VITE_PORTONE_WEBHOOK_URL,
  },
  images: {
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1536, 1920],
    formats: ["image/avif", "image/webp"],
    imageSizes: [48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 86400,
    remotePatterns: [
      {
        hostname: "**.supabase.co",
        pathname: "/storage/v1/**",
        protocol: "https",
      },
      ...(supabaseImageHostname
        ? [
            {
              hostname: supabaseImageHostname,
              pathname: "/storage/v1/**",
              protocol: "https" as const,
            },
          ]
        : []),
    ],
  },
  async redirects() {
    return [
      {
        source: "/operator",
        destination: "/admin/operator",
        permanent: false,
      },
      {
        source: "/operator/:path+",
        destination: "/admin/operator/:path+",
        permanent: false,
      },
      {
        source: "/owner",
        destination: "/admin/owner",
        permanent: false,
      },
      {
        source: "/owner/:path+",
        destination: "/admin/owner/:path+",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

import("@opennextjs/cloudflare").then((module) =>
  module.initOpenNextCloudflareForDev(),
);
