import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NINETY-NINE VINTAGE",
    short_name: "99 Vintage",
    description: "시간을 다시 입는 선택, 빈티지 라이브 옥션 & 14일 무료 보관 플랫폼",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "라이브 옥션",
        short_name: "옥션",
        url: "/live",
      },
      {
        name: "상담·채팅",
        short_name: "채팅",
        url: "/chat",
      },
      {
        name: "내 정보",
        short_name: "내 정보",
        url: "/my",
      },
    ],
  };
}
