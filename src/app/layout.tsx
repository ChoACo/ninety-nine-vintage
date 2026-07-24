import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ChatNotificationProvider } from "@/components/features/chat/ChatNotificationProvider";
import { OwnerMemberModeProvider } from "@/components/features/auth/OwnerMemberModeProvider";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const themeInitializationScript = `
(() => {
  const storageKey = "ninety-nine:color-theme";
  const root = document.documentElement;
  let theme = "light";
  try {
    const saved = localStorage.getItem(storageKey);
    theme = saved === "light" || saved === "dark"
      ? saved
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch {}
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#15181c" : "#fbfaf7");
})();`;

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ninety-nine-vintage.store"),
  title: "NINETY-NINE VINTAGE",
  description: "선별된 한 점의 빈티지를 바로 만나는 곳",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={geist.variable} lang="ko" suppressHydrationWarning>
      <head>
        <meta content="light dark" name="color-scheme" />
        <meta content="#fbfaf7" name="theme-color" />
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body className="font-sans antialiased">
        <OwnerMemberModeProvider>
          <ChatNotificationProvider>{children}</ChatNotificationProvider>
        </OwnerMemberModeProvider>
      </body>
    </html>
  );
}
