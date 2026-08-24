"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("root_layout_render_failed", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>
        <main
          style={{
            alignItems: "center",
            background: "#f6f3ed",
            color: "#18181b",
            display: "flex",
            fontFamily: "system-ui, sans-serif",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <section style={{ maxWidth: "480px" }}>
            <p style={{ fontSize: "12px", fontWeight: 800, letterSpacing: ".12em" }}>
              NINETY-NINE VINTAGE
            </p>
            <h1 style={{ fontSize: "24px", margin: "16px 0 0" }}>
              화면을 안전하게 복구하고 있습니다
            </h1>
            <p style={{ fontSize: "14px", lineHeight: 1.7, margin: "12px 0 0" }}>
              일시적인 오류로 페이지를 열지 못했습니다. 다시 시도하거나 홈으로
              이동해 주세요.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginTop: "24px" }}>
              <button
                onClick={reset}
                style={{ background: "#18181b", border: 0, color: "white", minHeight: "44px", padding: "0 20px" }}
                type="button"
              >
                다시 시도
              </button>
              <Link
                href="/home"
                style={{ alignItems: "center", border: "1px solid #18181b", color: "#18181b", display: "inline-flex", minHeight: "42px", padding: "0 20px", textDecoration: "none" }}
              >
                홈으로 이동
              </Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
