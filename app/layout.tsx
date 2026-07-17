import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "다미네 구제 | 믿고 참여하는 구제 의류 경매",
  description: "좋은 구제 의류를 투명한 입찰 내역과 함께 만나는 50대 맞춤형 경매",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
