import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NINETY-NINE VINTAGE",
  description: "선별된 한 점의 빈티지를 바로 만나는 곳",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={geist.variable} lang="ko">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
