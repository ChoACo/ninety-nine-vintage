import {
  MEMBER_GUIDE_NOTICE_IDS,
  MEMBER_GUIDE_NOTICE_ORDER,
  type MemberGuideNotice,
  type MemberGuideNoticeId,
} from "@/lib/notices/memberGuideNotices";
import { createSupabaseServerClients } from "@/lib/supabase/server";

const NOTICE_FIELDS =
  "id,title,body,image_paths,created_at,updated_at" as const;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { admin } = createSupabaseServerClients();
    const { data, error } = await admin
      .from("staff_board_posts")
      .select(NOTICE_FIELDS)
      .eq("kind", "notice")
      .in("id", [...MEMBER_GUIDE_NOTICE_IDS]);

    if (error) throw error;

    const allowedIds = new Set<string>(MEMBER_GUIDE_NOTICE_IDS);
    const notices = (data ?? [])
      .filter(
        (notice): notice is MemberGuideNotice & { id: MemberGuideNoticeId } =>
          allowedIds.has(notice.id) &&
          Array.isArray(notice.image_paths) &&
          notice.image_paths.every((path) => typeof path === "string"),
      )
      .sort(
        (left, right) =>
          (MEMBER_GUIDE_NOTICE_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (MEMBER_GUIDE_NOTICE_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      );

    return Response.json(
      { notices },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return Response.json(
      {
        code: "public_notices_unavailable",
        error: "public_notices_unavailable",
        message: "공지사항을 불러오지 못했습니다.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
