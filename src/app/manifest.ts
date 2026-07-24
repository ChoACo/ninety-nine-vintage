import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NINETY-NINE VINTAGE",
    short_name: "NINETY-NINE",
    description: "선별된 한 점의 빈티지를 바로 만나는 모바일 웹 앱",
    start_url: "/m/home",
    scope: "/",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#15181c",
    orientation: "portrait",
    icons: [
      {
        src: "/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/pwa-icon-512.png",
        sizes: "512x512",
        type: "image/png",
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
        name: "실시간 경매",
        short_name: "경매",
        url: "/m/feed",
      },
      {
        name: "상담·채팅",
        short_name: "채팅",
        url: "/m/chat",
      },
      {
        name: "내 정보",
        short_name: "내 정보",
        url: "/m/account",
      },
    ],
  };
}
