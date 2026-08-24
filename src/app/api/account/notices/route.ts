import {
  authenticateMemberCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";
import {
  MEMBER_GUIDE_NOTICE_IDS,
  MEMBER_GUIDE_NOTICE_ORDER,
  type MemberGuideNotice,
  type MemberGuideNoticeId,
} from "@/lib/notices/memberGuideNotices";

const NOTICE_FIELDS =
  "id,title,body,image_paths,created_at,updated_at" as const;

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from("staff_board_posts")
    .select(NOTICE_FIELDS)
    .eq("kind", "notice")
    .in("id", [...MEMBER_GUIDE_NOTICE_IDS]);

  if (error) {
    return commerceJson(
      {
        error: "member_notices_unavailable",
        message: "공지사항을 불러오지 못했습니다.",
      },
      503,
    );
  }

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

  return commerceJson({ notices });
}
