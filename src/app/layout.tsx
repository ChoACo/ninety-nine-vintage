import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { PcLayout } from "@/components/layout/PcLayout";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NINETY-NINE VINTAGE",
  description: "오늘 단 한 번, 다시 없는 빈티지 경매",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={geist.variable} lang="ko">
      <body className="font-sans antialiased">
        <PcLayout>{children}</PcLayout>
      </body>
    </html>
  );
}
