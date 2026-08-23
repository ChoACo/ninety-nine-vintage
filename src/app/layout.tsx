import type { Metadata } from "next";
import Script from "next/script";
import { ChatNotificationProvider } from "@/components/features/chat/ChatNotificationProvider";
import { GlobalToastHost } from "@/components/features/notifications/GlobalToastHost";
import { NotificationExperienceProvider } from "@/components/features/notifications/NotificationExperienceProvider";
import { SimpleModeProvider } from "@/components/features/accessibility/SimpleModeProvider";
import { ReturnScrollCapture } from "@/components/layout/ReturnScrollCapture";
import { ScrollLockRecovery } from "@/components/layout/ScrollLockRecovery";
import "./globals.css";

const themeInitializationScript = `
(() => {
  const storageKey = "ninety-nine:color-theme";
  const simpleModeStorageKey = "ninety-nine:simple-mode";
  const root = document.documentElement;
  let theme = "light";
  try {
    const saved = localStorage.getItem(storageKey);
    theme = saved === "light" || saved === "dark"
      ? saved
      : "light";
  } catch {}
  root.dataset.theme = theme;
  try {
    root.dataset.simpleMode = localStorage.getItem(simpleModeStorageKey) === "on"
      ? "on"
      : "off";
  } catch {
    root.dataset.simpleMode = "off";
  }
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === "dark" ? "#15181c" : "#fbfaf7";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#15181c" : "#fbfaf7");
})();`;

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ninety-nine-vintage.store"),
  title: "NINETY-NINE VINTAGE",
  description: "시간을 다시 입는 선택, 빈티지 라이브 옥션 & 14일 무료 보관 플랫폼",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "99 Vintage",
  },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [
      { url: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" style={{ backgroundColor: "#fbfaf7", colorScheme: "light" }} suppressHydrationWarning>
      <head>
        <meta content="light dark" name="color-scheme" />
        <meta content="#fbfaf7" name="theme-color" />
      </head>
      <body className="font-sans antialiased">
        <Script
          id="theme-initialization"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitializationScript }}
        />
        <SimpleModeProvider>
          <NotificationExperienceProvider>
            <ChatNotificationProvider>{children}</ChatNotificationProvider>
          </NotificationExperienceProvider>
        </SimpleModeProvider>
        <GlobalToastHost />
        <ReturnScrollCapture />
        <ScrollLockRecovery />
      </body>
    </html>
  );
}
