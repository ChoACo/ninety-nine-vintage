export const dynamic = "force-dynamic";

export function GET() {
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "development";
  return new Response(`${buildId}\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
