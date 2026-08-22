import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const BUCKET = "support-attachments";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

async function canAccessConversation(auth: Awaited<ReturnType<typeof authenticateMemberCommerceRequest>>, conversationId: string) {
  if (!auth.ok) return false;
  const { data, error } = await auth.user.from("support_conversations").select("id").eq("id", conversationId).maybeSingle();
  return !error && data?.id === conversationId;
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!isUuid(conversationId) || !await canAccessConversation(auth, conversationId)) {
    return commerceJson({ error: "attachment_forbidden", message: "첨부파일을 확인할 권한이 없습니다." }, 403);
  }
  const { data, error } = await auth.admin.from("support_message_attachments").select("id,message_id,mime_type,byte_size,object_path,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true });
  if (error) return commerceJson({ error: "attachments_unavailable", message: "첨부파일을 불러오지 못했습니다." }, 503);
  const attachments = await Promise.all((data ?? []).map(async (item) => {
    const signed = await auth.admin.storage.from(BUCKET).createSignedUrl(item.object_path, 300);
    return signed.data?.signedUrl ? { id: item.id, messageId: item.message_id, mimeType: item.mime_type, byteSize: item.byte_size, createdAt: item.created_at, signedUrl: signed.data.signedUrl, expiresInSeconds: 300 } : null;
  }));
  return commerceJson({ attachments: attachments.filter(Boolean) });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 512 * 1024) {
    return commerceJson({ error: "attachment_too_large", message: "첨부 이미지는 5MB 이하여야 합니다." }, 413);
  }
  const form = await request.formData().catch(() => null);
  if (!form || [...form.keys()].some((key) => !["conversationId", "messageId", "file"].includes(key))) {
    return commerceJson({ error: "invalid_attachment", message: "첨부 요청을 확인해 주세요." }, 422);
  }
  const conversationId = form.get("conversationId");
  const messageId = form.get("messageId");
  const file = form.get("file");
  if (!isUuid(conversationId) || !isUuid(messageId) || !(file instanceof File) || file.size < 1 || file.size > MAX_FILE_SIZE || !MIME_EXTENSIONS.has(file.type)) {
    return commerceJson({ error: "invalid_attachment", message: "5MB 이하 JPG, PNG, WEBP 이미지만 첨부할 수 있습니다." }, 422);
  }
  if (!await canAccessConversation(auth, conversationId)) {
    return commerceJson({ error: "attachment_forbidden", message: "이 상담에 이미지를 첨부할 권한이 없습니다." }, 403);
  }
  const { data: message, error: messageError } = await auth.user.from("support_messages").select("id,conversation_id,sender_id").eq("id", messageId).eq("conversation_id", conversationId).eq("sender_id", auth.userId).maybeSingle();
  if (messageError || !message) return commerceJson({ error: "message_not_found", message: "본인이 보낸 메시지에만 이미지를 첨부할 수 있습니다." }, 403);
  const { count, error: countError } = await auth.admin.from("support_message_attachments").select("id", { count: "exact", head: true }).eq("message_id", messageId);
  if (countError) return commerceJson({ error: "attachments_unavailable" }, 503);
  if ((count ?? 0) >= 3) return commerceJson({ error: "attachment_limit", message: "메시지 하나에는 이미지를 최대 3장 첨부할 수 있습니다." }, 409);

  const attachmentId = crypto.randomUUID();
  const extension = MIME_EXTENSIONS.get(file.type);
  if (!extension) return commerceJson({ error: "invalid_attachment" }, 422);
  const objectPath = `${conversationId}/${messageId}/${attachmentId}.${extension}`;
  const storage = auth.admin.storage.from(BUCKET);
  const uploaded = await storage.upload(objectPath, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (uploaded.error) return commerceJson({ error: "attachment_upload_failed", message: "이미지를 업로드하지 못했습니다." }, 503);
  const { data: attachment, error } = await auth.admin.from("support_message_attachments").insert({ id: attachmentId, conversation_id: conversationId, message_id: messageId, uploader_id: auth.userId, object_path: objectPath, mime_type: file.type, byte_size: file.size }).select("id,message_id,mime_type,byte_size,created_at").single();
  if (error || !attachment) {
    await storage.remove([objectPath]);
    return commerceJson({ error: "attachment_save_failed", message: "첨부 정보를 저장하지 못했습니다." }, 503);
  }
  const signed = await storage.createSignedUrl(objectPath, 300);
  if (!signed.data?.signedUrl) return commerceJson({ error: "attachment_unavailable" }, 503);
  return commerceJson({ attachment: { id: attachment.id, messageId: attachment.message_id, mimeType: attachment.mime_type, byteSize: attachment.byte_size, createdAt: attachment.created_at, signedUrl: signed.data.signedUrl, expiresInSeconds: 300 } }, 201);
}
