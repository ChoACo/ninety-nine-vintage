import type { Metadata, Viewport } from "next";
import { CommerceShell } from "@/src/components/common";
import "./globals.css";

const themeInitializationScript = `
(() => {
  const storageKey = "ninety-nine-theme";
  const legacyStorageKey = "damine-theme";
  let theme = "light";

  try {
    const savedTheme = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
    theme = savedTheme === "dark" ? "dark" : "light";
    if (!window.localStorage.getItem(storageKey) && savedTheme) {
      window.localStorage.setItem(storageKey, theme);
      window.localStorage.removeItem(legacyStorageKey);
    }
  } catch {
    // Keep the accessible light default when storage is unavailable.
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      "https://www.ninety-nine-vintage.store",
  ),
  title: "나인티 나인 빈티지 | 투명한 빈티지 의류 경매",
  description: "엄선한 빈티지 의류와 투명한 실시간 입찰을 만나는 나인티 나인 빈티지",
  icons: {
    icon: "/ninety-nine-vintage-brand.jpg",
    apple: "/ninety-nine-vintage-brand.jpg",
  },
  openGraph: {
    title: "나인티 나인 빈티지",
    description: "엄선한 빈티지 의류와 투명한 실시간 입찰",
    type: "website",
    locale: "ko_KR",
    images: [
      {
        url: "/ninety-nine-vintage-brand.jpg",
        width: 1024,
        height: 1024,
        alt: "나인티 나인 빈티지 공식 로고",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "나인티 나인 빈티지",
    description: "엄선한 빈티지 의류와 투명한 실시간 입찰",
    images: ["/ninety-nine-vintage-brand.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f0ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body>
        <CommerceShell>{children}</CommerceShell>
      </body>
    </html>
  );
}
