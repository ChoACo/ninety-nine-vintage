import { commerceJson } from "@/lib/commerce/server";
import { archiveExpiredRecords } from "@/lib/drive/archive";

function isCronSecretValid(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("x-cron-secret")?.trim();
  return Boolean(
    expected && supplied && expected.length === supplied.length && expected === supplied,
  );
}

export async function POST(request: Request) {
  if (!isCronSecretValid(request)) {
    return commerceJson({ error: "forbidden" }, 403);
  }
  try {
    const report = await archiveExpiredRecords();
    return commerceJson({
      result: report,
      archived: report.uploadedFileId !== null,
    });
  } catch (error) {
    return commerceJson(
      { error: "archive_failed", message: error instanceof Error ? error.message : "아카이브 실패" },
      503,
    );
  }
}
