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

// The strict production policy only allows hosted Supabase. A locally running
// Supabase CLI (http://127.0.0.1:54321) must stay reachable from the same
// browser session for local owner/operator scenario checks, so include the
// configured origin when it is not already covered by the hosted wildcard.
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return null;
  }
})();
const allowedConnectOrigins = [
  "https://*.supabase.co",
  "wss://*.supabase.co",
  "https://kauth.kakao.com",
  "https://kapi.kakao.com",
];
if (
  supabaseOrigin &&
  !supabaseOrigin.match(/^https:\/\//u) &&
  !allowedConnectOrigins.includes(supabaseOrigin)
) {
  allowedConnectOrigins.push(supabaseOrigin);
}

const r2PublicDomain = process.env.R2_PUBLIC_DOMAIN?.trim() || null;

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  `connect-src 'self' ${allowedConnectOrigins.join(" ")}`,
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `img-src 'self' data: blob: https://*.supabase.co https://storage.googleapis.com https://*.s3.amazonaws.com https://*.r2.cloudflarestorage.com${r2PublicDomain ? ` https://${r2PublicDomain}` : ""}`,
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  // React's dev-mode source-mapping relies on eval(), which the strict
  // production policy intentionally omits. Keep the relaxation dev-only so
  // the deployed worker never enables code execution.
  `script-src 'self' 'unsafe-inline'${
    process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
  }`,
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
  serverExternalPackages: ["exceljs"],
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  images: {
    remotePatterns: [
      ...(supabaseImageHostname
        ? [
            {
              hostname: supabaseImageHostname,
              pathname: "/storage/v1/**",
              protocol: "https" as const,
            },
          ]
        : []),
      { hostname: "*.supabase.co", pathname: "/storage/v1/**", protocol: "https" as const },
      { hostname: "storage.googleapis.com", pathname: "/**", protocol: "https" as const },
      { hostname: "*.s3.amazonaws.com", pathname: "/**", protocol: "https" as const },
      { hostname: "*.r2.cloudflarestorage.com", pathname: "/**", protocol: "https" as const },
      ...(r2PublicDomain
        ? [
            {
              hostname: r2PublicDomain,
              pathname: "/**",
              protocol: "https" as const,
            },
          ]
        : []),
    ],
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
