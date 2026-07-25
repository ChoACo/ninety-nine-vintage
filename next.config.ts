import type { NextConfig } from "next";

const supabaseImageHostname = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || null;
  } catch {
    return null;
  }
})();

const allowedDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://kauth.kakao.com https://kapi.kakao.com",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const nextConfig: NextConfig = {
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  // Keep the App Router in its default SSR mode. Product images use next/image;
  // the allow-list below limits remote optimization to Supabase Storage while
  // AVIF/WebP variants and device-specific srcsets reduce storefront payloads.
  images: {
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1536, 1920],
    formats: ["image/avif", "image/webp"],
    imageSizes: [48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 86400,
    remotePatterns: supabaseImageHostname
      ? [
          {
            hostname: supabaseImageHostname,
            pathname: "/storage/v1/**",
            protocol: "https" as const,
          },
        ]
      : [],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
    ];
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
