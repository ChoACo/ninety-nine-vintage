import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the App Router in its default SSR mode. Supabase Storage URLs are
  // currently rendered through regular <img> elements, so no remote image
  // allow-list is required for this runtime migration.
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
  async redirects() {
    return [
      {
        source: "/operator/:path*",
        destination: "/admin/operator/:path*",
        permanent: false,
      },
      {
        source: "/owner/:path*",
        destination: "/admin/owner/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
