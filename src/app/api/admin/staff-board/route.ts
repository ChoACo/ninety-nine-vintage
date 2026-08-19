import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const POST_FIELDS = "id,kind,title,body,author_id,author_role,is_pinned,image_paths,created_at,updated_at";
const COMMENT_FIELDS = "id,post_id,author_id,author_role,body,created_at";

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;

  const [{ data: posts, error: postError }, { data: comments, error: commentError }] = await Promise.all([
    auth.admin.from("staff_board_posts").select(POST_FIELDS).order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    auth.admin.from("staff_board_comments").select(COMMENT_FIELDS).order("created_at", { ascending: true }).limit(500),
  ]);
  if (postError || commentError) return commerceJson({ error: "staff_board_unavailable", message: "게시판을 불러오지 못했습니다." }, 503);

  const authorIds = [...new Set([...(posts ?? []), ...(comments ?? [])].map((row) => row.author_id).filter((id): id is string => Boolean(id)))];
  const { data: profiles, error: profileError } = authorIds.length
    ? await auth.admin.from("profiles").select("id,display_name").in("id", authorIds)
    : { data: [], error: null };
  if (profileError) return commerceJson({ error: "staff_board_unavailable", message: "작성자 정보를 불러오지 못했습니다." }, 503);
  const names = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile.display_name]));

  return commerceJson({
    roleCode: auth.roleCode,
    userId: auth.effectiveUserId,
    posts: (posts ?? []).map((post) => ({
      ...post,
      authorName: post.author_id ? names[post.author_id] ?? "운영팀" : "사이트 운영팀",
      comments: (comments ?? []).filter((comment) => comment.post_id === post.id).map((comment) => ({
        ...comment,
        authorName: comment.author_id ? names[comment.author_id] ?? "운영팀" : "사이트 운영팀",
      })),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return commerceJson({ error: "invalid_request", message: "입력 내용을 확인해 주세요." }, 422);

  if (body.action === "create_post") {
    const kind = body.kind === "notice" ? "notice" : body.kind === "discussion" ? "discussion" : null;
    const title = cleanText(body.title, 120);
    const content = cleanText(body.body, 10000);
    if (!kind || title.length < 2 || content.length < 2) return commerceJson({ error: "invalid_post", message: "제목과 내용을 입력해 주세요." }, 422);
    if (kind === "notice" && auth.roleCode !== "owner") return commerceJson({ error: "notice_forbidden", message: "공지사항은 사이트 소유자만 작성할 수 있습니다." }, 403);
    const { data, error } = await auth.admin.from("staff_board_posts").insert({
      kind,
      title,
      body: content,
      author_id: auth.effectiveUserId,
      author_role: auth.roleCode,
      is_pinned: kind === "notice" && body.isPinned === true,
      image_paths: [],
    }).select(POST_FIELDS).single();
    if (error) return commerceJson({ error: "post_create_failed", message: "글을 등록하지 못했습니다." }, 409);
    return commerceJson({ post: data }, 201);
  }

  if (body.action === "create_comment") {
    const postId = cleanText(body.postId, 36);
    const content = cleanText(body.body, 2000);
    if (!postId || !content) return commerceJson({ error: "invalid_comment", message: "댓글 내용을 입력해 주세요." }, 422);
    const { data: post } = await auth.admin.from("staff_board_posts").select("id").eq("id", postId).maybeSingle();
    if (!post) return commerceJson({ error: "post_not_found", message: "게시글을 찾을 수 없습니다." }, 404);
    const { data, error } = await auth.admin.from("staff_board_comments").insert({
      post_id: postId,
      author_id: auth.effectiveUserId,
      author_role: auth.roleCode,
      body: content,
    }).select(COMMENT_FIELDS).single();
    if (error) return commerceJson({ error: "comment_create_failed", message: "댓글을 등록하지 못했습니다." }, 409);
    return commerceJson({ comment: data }, 201);
  }

  return commerceJson({ error: "invalid_action", message: "지원하지 않는 작업입니다." }, 422);
}
